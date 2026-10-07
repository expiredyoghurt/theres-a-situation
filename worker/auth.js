// v2.0 — extracted from the v1.x single-file worker without behaviour changes.
import { hashPassword, json, verifyPassword } from "./common.js";
import { DEFAULT_MASTERY_THRESHOLD, DEFAULT_WEIGHTS, SESSION_TTL_MS } from "./config.js";

// ---------- auth ----------

export async function requireAuth(env, request, handler, opts = {}) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return json({ error: "Not authenticated" }, 401);
  let row;
  try {
    row = await env.DB.prepare(
      "SELECT token, user_id, role, username, expires_at FROM admin_sessions WHERE token = ?"
    ).bind(token).first();
  } catch (e) {
    return json({ error: "Database not set up. Run schema.sql against your D1 database first." }, 500);
  }
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return json({ error: "Session expired, please log in again" }, 401);
  }
  if (opts.adminOnly && row.role !== "admin") {
    return json({ error: "Admin access required" }, 403);
  }
  const session = { userId: row.user_id, role: row.role, username: row.username };
  return handler(session);
}

export async function getTeacherClasses(env, userId) {
  const { results } = await env.DB.prepare(
    "SELECT class_name FROM teacher_classes WHERE teacher_id = ? ORDER BY class_name"
  ).bind(userId).all();
  return (results || []).map((r) => r.class_name);
}

export const LOGIN_FAIL_THRESHOLD = 5; // failures before any lockout kicks in
export const LOGIN_LOCK_CAP_MINUTES = 30; // ceiling on the exponential backoff

/** Returns an ISO lock-expiry string if this username is currently
 * locked out, or null if it's free to attempt. Fails open (no lockout)
 * if the table isn't migrated yet, rather than blocking all logins. */
export async function checkLoginLock(env, username) {
  try {
    const row = await env.DB.prepare("SELECT locked_until FROM login_attempts WHERE username = ?").bind(username).first();
    if (row && row.locked_until && new Date(row.locked_until.replace(" ", "T") + "Z").getTime() > Date.now()) {
      return row.locked_until;
    }
  } catch (e) { /* login_attempts table not migrated — no lockout enforced */ }
  return null;
}

/** Exponential backoff after LOGIN_FAIL_THRESHOLD consecutive failures:
 * 1 min, 2 min, 4 min, ... capped at LOGIN_LOCK_CAP_MINUTES. */
export async function recordLoginFailure(env, username) {
  try {
    const row = await env.DB.prepare("SELECT fail_count FROM login_attempts WHERE username = ?").bind(username).first();
    const failCount = (row?.fail_count || 0) + 1;
    let lockedUntil = null;
    if (failCount >= LOGIN_FAIL_THRESHOLD) {
      const lockMinutes = Math.min(LOGIN_LOCK_CAP_MINUTES, Math.pow(2, failCount - LOGIN_FAIL_THRESHOLD));
      lockedUntil = new Date(Date.now() + lockMinutes * 60000).toISOString();
    }
    await env.DB.prepare(
      "INSERT INTO login_attempts (username, fail_count, locked_until) VALUES (?,?,?) " +
      "ON CONFLICT(username) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until"
    ).bind(username, failCount, lockedUntil).run();
  } catch (e) { /* login_attempts table not migrated — fails open */ }
}

export async function clearLoginFailures(env, username) {
  try {
    await env.DB.prepare("DELETE FROM login_attempts WHERE username = ?").bind(username).run();
  } catch (e) { /* ignore */ }
}

export async function adminLogin(env, request) {
  const body = await request.json().catch(() => ({}));
  const username = (body.username || "").toString().trim();
  const password = (body.password || "").toString();
  if (!username || !password) return json({ error: "Username and password required" }, 400);

  const lockedUntil = await checkLoginLock(env, username);
  if (lockedUntil) {
    return json({ error: `Too many failed attempts for this account. Try again after ${lockedUntil} UTC.` }, 429);
  }

  let userRow;
  try {
    userRow = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  } catch (e) {
    return json({ error: "Database not set up. Run schema.sql against your D1 database first." }, 500);
  }

  // Bootstrap: if there are NO accounts yet, allow the seed credentials
  // (set via `wrangler secret put SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`)
  // to create the first admin account.
  if (!userRow) {
    const { count } = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
    if (count === 0 && env.SEED_ADMIN_USERNAME && env.SEED_ADMIN_PASSWORD &&
        username === env.SEED_ADMIN_USERNAME && password === env.SEED_ADMIN_PASSWORD) {
      const { hash, salt } = await hashPassword(password);
      const inserted = await env.DB.prepare(
        "INSERT INTO users (username, password_hash, password_salt, role) VALUES (?,?,?, 'admin')"
      ).bind(username, hash, salt).run();
      userRow = { id: inserted.meta.last_row_id, username, role: "admin" };
    } else {
      await recordLoginFailure(env, username);
      return json({ error: "Invalid credentials" }, 401);
    }
  } else {
    const ok = await verifyPassword(password, userRow.password_salt, userRow.password_hash);
    if (!ok) {
      await recordLoginFailure(env, username);
      return json({ error: "Invalid credentials" }, 401);
    }
  }

  await clearLoginFailures(env, username);

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare(
    "INSERT INTO admin_sessions (token, user_id, role, username, expires_at) VALUES (?,?,?,?,?)"
  ).bind(token, userRow.id, userRow.role, userRow.username, expiresAt).run();

  const classes = userRow.role === "teacher" ? await getTeacherClasses(env, userRow.id) : null;
  return json({ token, expiresAt, role: userRow.role, username: userRow.username, classes });
}

export async function adminMe(env, session) {
  const classes = session.role === "teacher" ? await getTeacherClasses(env, session.userId) : null;
  return json({ username: session.username, role: session.role, classes });
}

export async function changePassword(env, request, session) {
  const body = await request.json().catch(() => ({}));
  const password = (body.password || "").toString();
  if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);
  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(hash, salt, session.userId).run();
  return json({ ok: true });
}

// ---------- teacher account management (admin only) ----------

export async function adminListTeachers(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, username, created_at FROM users WHERE role = 'teacher' ORDER BY created_at DESC"
  ).all();
  const teachers = [];
  for (const t of results || []) {
    const classes = await getTeacherClasses(env, t.id);
    teachers.push({ id: t.id, username: t.username, createdAt: t.created_at, classes });
  }
  return json({ teachers });
}

export async function adminCreateTeacher(env, request) {
  const body = await request.json().catch(() => ({}));
  const username = (body.username || "").toString().trim();
  const password = (body.password || "").toString();
  const classes = Array.isArray(body.classes) ? body.classes.map((c) => c.toString().trim().toUpperCase()).filter(Boolean) : [];
  if (!username || password.length < 6) {
    return json({ error: "Username and a password of at least 6 characters are required" }, 400);
  }
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (existing) return json({ error: "That username is already taken" }, 409);

  const { hash, salt } = await hashPassword(password);
  const inserted = await env.DB.prepare(
    "INSERT INTO users (username, password_hash, password_salt, role) VALUES (?,?,?, 'teacher')"
  ).bind(username, hash, salt).run();
  const teacherId = inserted.meta.last_row_id;
  for (const c of classes) {
    await env.DB.prepare("INSERT OR IGNORE INTO teacher_classes (teacher_id, class_name) VALUES (?,?)")
      .bind(teacherId, c).run();
  }
  return json({ id: teacherId, username, classes });
}

export async function adminUpdateTeacher(env, request, id) {
  const body = await request.json().catch(() => ({}));
  const teacher = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND role = 'teacher'").bind(id).first();
  if (!teacher) return json({ error: "Teacher not found" }, 404);

  if (Array.isArray(body.classes)) {
    const classes = body.classes.map((c) => c.toString().trim().toUpperCase()).filter(Boolean);
    await env.DB.prepare("DELETE FROM teacher_classes WHERE teacher_id = ?").bind(id).run();
    for (const c of classes) {
      await env.DB.prepare("INSERT OR IGNORE INTO teacher_classes (teacher_id, class_name) VALUES (?,?)")
        .bind(id, c).run();
    }
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);
    const { hash, salt } = await hashPassword(body.password);
    await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
      .bind(hash, salt, id).run();
  }
  const classes = await getTeacherClasses(env, id);
  return json({ id, username: teacher.username, classes });
}

export async function adminDeleteTeacher(env, id) {
  await env.DB.prepare("DELETE FROM teacher_classes WHERE teacher_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM admin_sessions WHERE user_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM users WHERE id = ? AND role = 'teacher'").bind(id).run();
  return json({ ok: true });
}

// ---------- rubric config ----------

export async function getRubric(env) {
  try {
    const row = await env.DB.prepare("SELECT weights, mastery_threshold FROM rubric_config WHERE id = 1").first();
    if (!row) throw new Error("no rubric row");
    const weights = JSON.parse(row.weights);
    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    return { weights, masteryThreshold: row.mastery_threshold, total };
  } catch (e) {
    const total = Object.values(DEFAULT_WEIGHTS).reduce((s, v) => s + v, 0);
    return { weights: DEFAULT_WEIGHTS, masteryThreshold: DEFAULT_MASTERY_THRESHOLD, total };
  }
}

export async function saveRubricRoute(env, request) {
  const body = await request.json().catch(() => ({}));
  const weights = body.weights || {};
  const required = ["taskIdentification", "stimulusKeyInfo", "ownContent", "letterChoices", "paragraphing", "overallQuality"];
  const cleanWeights = {};
  for (const key of required) {
    const v = Number(weights[key]);
    if (!Number.isFinite(v) || v < 0) return json({ error: `Invalid points value for ${key}` }, 400);
    cleanWeights[key] = Math.round(v);
  }
  const threshold = Number(body.masteryThreshold);
  const total = Object.values(cleanWeights).reduce((s, v) => s + v, 0);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > total) {
    return json({ error: `Mastery threshold must be between 0 and the total marks (${total})` }, 400);
  }
  await env.DB.prepare(
    "INSERT INTO rubric_config (id, mastery_threshold, weights) VALUES (1, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET mastery_threshold = excluded.mastery_threshold, weights = excluded.weights"
  ).bind(Math.round(threshold), JSON.stringify(cleanWeights)).run();
  return json({ weights: cleanWeights, masteryThreshold: Math.round(threshold), total });
}

