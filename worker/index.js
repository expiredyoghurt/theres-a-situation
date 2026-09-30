/**
 * Boss! There's a situation! — Worker
 * Version: v1.11
 * Serves the API. Static files (public/) are served automatically by the
 * [assets] binding for any request this file doesn't explicitly handle.
 *
 * Pupil-facing routes:
 *   GET  /api/cases                 -> list of cases (safe fields only)
 *   GET  /api/cases/:id             -> one case, safe fields only (no answer key)
 *   POST /api/cases/:id/submit      -> { name, playerClass, taskAnswers, stimulusSelected,
 *                                        ownContent, componentChoices, paragraphBreaks }
 *                                      -> { score, max, breakdown, improvement? }
 *   GET  /api/leaderboard           -> unified top scores, across all cases
 *
 * Auth:
 *   POST /api/admin/login           -> { username, password } -> { token, role, username, classes }
 *                                      (the very first login creates the first admin account —
 *                                      see SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD in wrangler.toml)
 *   GET  /api/admin/me              -> current session info
 *   POST /api/admin/change-password -> { password } -> change own password
 *
 * Case management (admin or teacher):
 *   GET    /api/admin/cases            -> all cases incl. drafts + answer keys
 *   POST   /api/admin/cases            -> AI-build a case from teacher input — always
 *                                          created as a DRAFT, never immediately visible
 *                                          to pupils (see "publish" below)
 *   PUT    /api/admin/cases/:id/publish -> review passed — make a draft case live;
 *                                          records who approved it and when
 *   POST   /api/admin/cases/:id/regenerate -> { part } -> re-run just ONE small AI
 *                                          piece of an existing case (e.g. "purpose",
 *                                          "keyinfo1", "taskChunks") without rebuilding
 *                                          the whole thing
 *   DELETE /api/admin/cases/:id        -> remove a teacher-uploaded case
 *
 * Marking rubric (admin or teacher):
 *   GET /api/admin/rubric           -> { weights, masteryThreshold, total }
 *   PUT /api/admin/rubric           -> { weights, masteryThreshold } -> save
 *
 * Teacher accounts (admin only):
 *   GET    /api/admin/teachers      -> list teacher accounts + assigned classes
 *   POST   /api/admin/teachers      -> { username, password, classes: [...] } -> create
 *   PUT    /api/admin/teachers/:id  -> { classes?, password? } -> update
 *   DELETE /api/admin/teachers/:id  -> remove a teacher account
 *
 * Class performance overview (admin sees all classes; teachers see only
 * classes assigned to them):
 *   GET /api/admin/classes          -> classes this account may view
 *   GET /api/admin/overview?class=X -> heatmap data for one class
 *   GET /api/admin/misconceptions?class=X -> common wrong-option mix-ups for one class
 *
 * AI provider health (admin or teacher):
 *   GET /api/admin/ai-health        -> per-provider success/fail counts, last 24h
 *
 * AI marking runs through a provider fallback chain (see callAI() below):
 * OpenRouter -> Groq -> Gemini -> Cloudflare Workers AI. Every AI call in
 * this file goes through that one function, so the whole game degrades
 * gracefully to deterministic scoring if every provider is unavailable.
 */

import { DEMO_CASES } from "./demoCases.js";

const APP_VERSION = "v1.11";
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const AI_TIMEOUT_MS = 9000; // per-provider timeout before falling through the chain
const REVIEW_COOLDOWN_HOURS = 20; // spaced-review: don't re-suggest a below-threshold case sooner than this

// Fallback rubric, used only if rubric_config hasn't been created yet
// (e.g. schema.sql not re-run against an older database).
const DEFAULT_WEIGHTS = {
  taskIdentification: 15,
  stimulusKeyInfo: 20,
  ownContent: 15,
  letterChoices: 30,
  paragraphing: 10,
  overallQuality: 10,
};
const DEFAULT_MASTERY_THRESHOLD = 85;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---------- pupil-facing ----------
      if (path === "/api/cases" && request.method === "GET") {
        return await listCases(env);
      }
      const caseMatch = path.match(/^\/api\/cases\/([a-zA-Z0-9_-]+)$/);
      if (caseMatch && request.method === "GET") {
        return await getCase(env, caseMatch[1]);
      }
      const submitMatch = path.match(/^\/api\/cases\/([a-zA-Z0-9_-]+)\/submit$/);
      if (submitMatch && request.method === "POST") {
        return await submitCase(env, request, submitMatch[1]);
      }
      if (path === "/api/version" && request.method === "GET") {
        return json({ version: APP_VERSION });
      }
      if (path === "/api/leaderboard" && request.method === "GET") {
        return await getLeaderboard(env, url);
      }
      if (path === "/api/practice-due" && request.method === "GET") {
        return await getPracticeDue(env, url);
      }
      if (path === "/api/my-scores" && request.method === "GET") {
        return await getMyScores(env, url);
      }

      // ---------- auth ----------
      if (path === "/api/admin/login" && request.method === "POST") {
        return await adminLogin(env, request);
      }
      if (path === "/api/admin/me" && request.method === "GET") {
        return await requireAuth(env, request, (session) => adminMe(env, session));
      }
      if (path === "/api/admin/change-password" && request.method === "POST") {
        return await requireAuth(env, request, (session) => changePassword(env, request, session));
      }

      // ---------- case management (any authenticated role) ----------
      if (path === "/api/admin/cases" && request.method === "GET") {
        return await requireAuth(env, request, () => adminListCases(env));
      }
      if (path === "/api/admin/cases" && request.method === "POST") {
        return await requireAuth(env, request, (session) => adminCreateCase(env, request, session));
      }
      if (path === "/api/admin/cases/manual" && request.method === "POST") {
        return await requireAuth(env, request, (session) => adminCreateManualCase(env, request, session));
      }
      const publishMatch = path.match(/^\/api\/admin\/cases\/([a-zA-Z0-9_-]+)\/publish$/);
      if (publishMatch && request.method === "PUT") {
        return await requireAuth(env, request, (session) => adminPublishCase(env, publishMatch[1], session));
      }
      const regenMatch = path.match(/^\/api\/admin\/cases\/([a-zA-Z0-9_-]+)\/regenerate$/);
      if (regenMatch && request.method === "POST") {
        return await requireAuth(env, request, () => adminRegenerateCasePart(env, request, regenMatch[1]));
      }
      const componentsMatch = path.match(/^\/api\/admin\/cases\/([a-zA-Z0-9_-]+)\/components$/);
      if (componentsMatch && request.method === "PUT") {
        return await requireAuth(env, request, (session) => adminSaveCaseComponents(env, request, componentsMatch[1], session));
      }
      const imageMatch = path.match(/^\/api\/admin\/cases\/([a-zA-Z0-9_-]+)\/image$/);
      if (imageMatch && request.method === "PUT") {
        return await requireAuth(env, request, (session) => adminUpdateCaseImage(env, request, imageMatch[1], session));
      }
      const delMatch = path.match(/^\/api\/admin\/cases\/([a-zA-Z0-9_-]+)$/);
      if (delMatch && request.method === "DELETE") {
        return await requireAuth(env, request, () => adminDeleteCase(env, delMatch[1]));
      }

      // ---------- rubric (any authenticated role) ----------
      if (path === "/api/admin/rubric" && request.method === "GET") {
        return await requireAuth(env, request, async () => json(await getRubric(env)));
      }
      if (path === "/api/admin/rubric" && request.method === "PUT") {
        return await requireAuth(env, request, () => saveRubricRoute(env, request));
      }
      if (path === "/api/admin/ai-health" && request.method === "GET") {
        return await requireAuth(env, request, () => adminAiHealth(env));
      }
      if (path === "/api/admin/student-access" && request.method === "GET") {
        return await requireAuth(env, request, () => getStudentAccessSetting(env));
      }
      if (path === "/api/admin/student-access" && request.method === "PUT") {
        return await requireAuth(env, request, (session) => setStudentAccessSetting(env, request, session));
      }
      if (path === "/api/admin/tutorial-access" && request.method === "GET") {
        return await requireAuth(env, request, () => getTutorialAccessSetting(env));
      }
      if (path === "/api/admin/tutorial-access" && request.method === "PUT") {
        return await requireAuth(env, request, (session) => setTutorialAccessSetting(env, request, session));
      }

      // ---------- teacher accounts (admin only) ----------
      if (path === "/api/admin/teachers" && request.method === "GET") {
        return await requireAuth(env, request, () => adminListTeachers(env), { adminOnly: true });
      }
      if (path === "/api/admin/teachers" && request.method === "POST") {
        return await requireAuth(env, request, () => adminCreateTeacher(env, request), { adminOnly: true });
      }
      const teacherMatch = path.match(/^\/api\/admin\/teachers\/(\d+)$/);
      if (teacherMatch && request.method === "PUT") {
        return await requireAuth(env, request, () => adminUpdateTeacher(env, request, Number(teacherMatch[1])), { adminOnly: true });
      }
      if (teacherMatch && request.method === "DELETE") {
        return await requireAuth(env, request, () => adminDeleteTeacher(env, Number(teacherMatch[1])), { adminOnly: true });
      }

      // ---------- class performance overview ----------
      if (path === "/api/admin/classes" && request.method === "GET") {
        return await requireAuth(env, request, (session) => adminListClasses(env, session));
      }
      if (path === "/api/admin/overview" && request.method === "GET") {
        return await requireAuth(env, request, (session) => adminOverview(env, session, url));
      }
      if (path === "/api/admin/misconceptions" && request.method === "GET") {
        return await requireAuth(env, request, (session) => adminMisconceptions(env, session, url));
      }

      // Not an API route — let the static asset handler take it.
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: "Server error", detail: String(err && err.message || err) }, 500);
    }
  },
};

// ---------- helpers ----------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

// ---------- password hashing (Web Crypto PBKDF2 — no external deps) ----------

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

async function verifyPassword(password, saltHex, expectedHashHex) {
  const { hash } = await hashPassword(password, saltHex);
  if (hash.length !== expectedHashHex.length) return false;
  // constant-time-ish compare
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
  return diff === 0;
}

// ---------- auth ----------

async function requireAuth(env, request, handler, opts = {}) {
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

async function getTeacherClasses(env, userId) {
  const { results } = await env.DB.prepare(
    "SELECT class_name FROM teacher_classes WHERE teacher_id = ? ORDER BY class_name"
  ).bind(userId).all();
  return (results || []).map((r) => r.class_name);
}

const LOGIN_FAIL_THRESHOLD = 5; // failures before any lockout kicks in
const LOGIN_LOCK_CAP_MINUTES = 30; // ceiling on the exponential backoff

/** Returns an ISO lock-expiry string if this username is currently
 * locked out, or null if it's free to attempt. Fails open (no lockout)
 * if the table isn't migrated yet, rather than blocking all logins. */
async function checkLoginLock(env, username) {
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
async function recordLoginFailure(env, username) {
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

async function clearLoginFailures(env, username) {
  try {
    await env.DB.prepare("DELETE FROM login_attempts WHERE username = ?").bind(username).run();
  } catch (e) { /* ignore */ }
}

async function adminLogin(env, request) {
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

async function adminMe(env, session) {
  const classes = session.role === "teacher" ? await getTeacherClasses(env, session.userId) : null;
  return json({ username: session.username, role: session.role, classes });
}

async function changePassword(env, request, session) {
  const body = await request.json().catch(() => ({}));
  const password = (body.password || "").toString();
  if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);
  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(hash, salt, session.userId).run();
  return json({ ok: true });
}

// ---------- teacher account management (admin only) ----------

async function adminListTeachers(env) {
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

async function adminCreateTeacher(env, request) {
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

async function adminUpdateTeacher(env, request, id) {
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

async function adminDeleteTeacher(env, id) {
  await env.DB.prepare("DELETE FROM teacher_classes WHERE teacher_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM admin_sessions WHERE user_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM users WHERE id = ? AND role = 'teacher'").bind(id).run();
  return json({ ok: true });
}

// ---------- rubric config ----------

async function getRubric(env) {
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

async function saveRubricRoute(env, request) {
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

// ---------- class performance overview ----------

async function adminListClasses(env, session) {
  let dbClasses = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT DISTINCT player_class FROM leaderboard WHERE player_class != '' ORDER BY player_class"
    ).all();
    dbClasses = (results || []).map((r) => r.player_class);
  } catch (e) { /* leaderboard not migrated with player_class yet */ }

  if (session.role === "admin") {
    return json({ classes: dbClasses });
  }
  const assigned = await getTeacherClasses(env, session.userId);
  // Show assigned classes even if nobody has played yet, but never leak
  // classes outside this teacher's assignment.
  const visible = Array.from(new Set(assigned));
  return json({ classes: visible });
}

/** Shared access check: admins can view any class; teachers only classes
 * assigned to them. Returns an error Response to short-circuit with, or
 * null if access is fine. */
async function checkClassAccess(env, session, className) {
  if (session.role === "admin") return null;
  const assigned = await getTeacherClasses(env, session.userId);
  if (!assigned.map((c) => c.toUpperCase()).includes(className)) {
    return json({ error: "You are not assigned to that class" }, 403);
  }
  return null;
}

async function adminOverview(env, session, url) {
  const className = (url.searchParams.get("class") || "").trim().toUpperCase();
  if (!className) return json({ error: "Missing ?class= parameter" }, 400);
  const denied = await checkClassAccess(env, session, className);
  if (denied) return denied;

  let rows = [];
  try {
    // Group by device_id as well as name — two pupils who happen to share
    // a first name (common in a class of 30) would otherwise have their
    // scores silently merged into one heatmap row.
    const { results } = await env.DB.prepare(
      `SELECT player_name, device_id, case_title, MAX(score) as best, MAX(max_score) as mx
       FROM leaderboard WHERE player_class = ?
       GROUP BY player_name, device_id, case_title
       ORDER BY player_name`
    ).bind(className).all();
    rows = results || [];
  } catch (e) {
    return json({ class: className, cases: [], pupils: [], note: "Leaderboard table not migrated yet — run schema.sql against your D1 database." });
  }

  const caseTitles = Array.from(new Set(rows.map((r) => r.case_title)));

  // Only disambiguate a name with a device-id suffix when there's an
  // actual collision (2+ distinct device ids sharing that name) — legacy
  // rows from before device_id existed all share an empty string and
  // should keep behaving like before (merged), not sprout a fake suffix.
  const devicesByName = new Map();
  for (const r of rows) {
    if (!devicesByName.has(r.player_name)) devicesByName.set(r.player_name, new Set());
    devicesByName.get(r.player_name).add(r.device_id || "");
  }

  const byPupil = new Map();
  for (const r of rows) {
    const pupilKey = r.player_name + "||" + (r.device_id || "");
    if (!byPupil.has(pupilKey)) {
      const hasCollision = (devicesByName.get(r.player_name)?.size || 1) > 1;
      const displayName = hasCollision && r.device_id ? `${r.player_name} (#${r.device_id.slice(0, 4)})` : r.player_name;
      byPupil.set(pupilKey, { name: displayName, scores: {} });
    }
    byPupil.get(pupilKey).scores[r.case_title] = { score: r.best, max: r.mx };
  }
  const pupils = Array.from(byPupil.values()).map((p) => {
    const pcts = caseTitles
      .filter((t) => p.scores[t])
      .map((t) => (p.scores[t].score / p.scores[t].max) * 100);
    p.average = pcts.length ? Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length) : null;
    return p;
  });
  pupils.sort((a, b) => (b.average ?? -1) - (a.average ?? -1));

  return json({ class: className, cases: caseTitles, pupils });
}

/**
 * Common-mistakes view: for a class, find MCQ components where a
 * particular WRONG option gets picked disproportionately often — a
 * signal of a class-wide misconception ("half the class thinks this is
 * a formal sign-off") that a plain average score can't show.
 */
async function adminMisconceptions(env, session, url) {
  const className = (url.searchParams.get("class") || "").trim().toUpperCase();
  if (!className) return json({ error: "Missing ?class= parameter" }, 400);
  const denied = await checkClassAccess(env, session, className);
  if (denied) return denied;

  let rows = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT case_id, case_title, component_key, option_id, COUNT(*) as picks
       FROM option_picks WHERE player_class = ?
       GROUP BY case_id, component_key, option_id
       ORDER BY case_id, component_key`
    ).bind(className).all();
    rows = results || [];
  } catch (e) {
    return json({ class: className, misconceptions: [], note: "option_picks table not migrated yet — run schema.sql against your D1 database." });
  }
  if (!rows.length) return json({ class: className, misconceptions: [] });

  const grouped = new Map();
  for (const r of rows) {
    const key = r.case_id + "::" + r.component_key;
    if (!grouped.has(key)) grouped.set(key, { caseId: r.case_id, caseTitle: r.case_title, componentKey: r.component_key, options: [] });
    grouped.get(key).options.push({ optionId: r.option_id, picks: r.picks });
  }

  const misconceptions = [];
  const caseCache = new Map();
  for (const g of grouped.values()) {
    if (!caseCache.has(g.caseId)) caseCache.set(g.caseId, await findFullCase(env, g.caseId));
    const full = caseCache.get(g.caseId);
    if (!full) continue;
    const correctId = full.answerKey?.components?.[g.componentKey];
    const comp = full.components.find((c) => c.key === g.componentKey);
    if (!comp) continue;
    const totalPicks = g.options.reduce((s, o) => s + o.picks, 0);
    const wrongOptions = g.options.filter((o) => o.optionId !== correctId).sort((a, b) => b.picks - a.picks);
    const topWrong = wrongOptions[0];
    // Only surface it if there's a real sample size and it's a genuinely
    // popular wrong pick, not just noise from one or two attempts.
    if (topWrong && totalPicks >= 4 && topWrong.picks / totalPicks >= 0.3) {
      const optionText = comp.options.find((o) => o.id === topWrong.optionId)?.text || "(option text unavailable)";
      misconceptions.push({
        caseTitle: g.caseTitle,
        component: comp.label,
        wrongOptionText: optionText,
        pickCount: topWrong.picks,
        totalPicks,
        pickRate: Math.round((topWrong.picks / totalPicks) * 100),
      });
    }
  }
  misconceptions.sort((a, b) => b.pickRate - a.pickRate);

  return json({ class: className, misconceptions });
}

/** Strip fields pupils shouldn't see (correct answers, keyword lists). */
function toPublicCase(c) {
  return {
    id: c.id,
    title: c.title,
    imageData: c.image_data ?? c.imageData,
    taskText: c.task_text ?? c.taskText,
    taskChunks: (typeof c.task_chunks === "string" ? JSON.parse(c.task_chunks) : c.taskChunks)
      .map(({ id, text }) => ({ id, text })), // strip `type`
    formal: !!(c.formal ?? c.formal === 1),
    stimulusPoints: (typeof c.stimulus_points === "string" ? JSON.parse(c.stimulus_points) : c.stimulusPoints)
      .map(({ id, text }) => ({ id, text })), // strip `relevant`
    ownContentPrompt: c.own_content_prompt ?? c.ownContentPrompt,
    components: (typeof c.components === "string" ? JSON.parse(c.components) : c.components)
      .map((comp) => ({
        key: comp.key,
        label: comp.label,
        options: comp.options.map((o) => ({ id: o.id, text: o.text })), // strip correctness
      })),
  };
}

function fullCaseFromRow(row) {
  const full = {
    ...row,
    taskChunks: JSON.parse(row.task_chunks),
    stimulusPoints: JSON.parse(row.stimulus_points),
    ownContentKeywords: JSON.parse(row.own_content_keywords || "[]"),
    components: JSON.parse(row.components),
    answerKey: JSON.parse(row.answer_key),
  };
  return ensureV16Components(full);
}

function ensureV16Components(full) {
  if (Array.isArray(full.components) && JSON.stringify(full.components.map(c => c.key)) === JSON.stringify(FIXED_COMPONENT_KEYS)) return full;
  const old = Object.fromEntries((full.components || []).map(c => [c.key, c]));
  const oldAnswers = full.answerKey?.components || {};
  const pts = (full.stimulusPoints || []).filter(p => p.relevant).map(p => p.text);
  const formal = !!(full.formal ?? full.formal === 1);
  const existingSet = (key, fallback, d1, d2) => {
    const c = old[key]; const correctId = oldAnswers[key] || "a"; const correct = c?.options?.find(o => o.id === correctId)?.text || fallback;
    const others = (c?.options || []).filter(o => o.id !== correctId).map(o => o.text).filter(Boolean);
    return { correct, distractors: [others[0] || d1, others[1] || d2] };
  };
  const sets = {
    salutation: existingSet("salutation", formal ? "Dear Sir/Madam," : "Hi there,", "Dear friend,", "Hey everyone,"),
    greeting: existingSet("greeting", formal ? "I hope you are well." : "How are you? I hope you have been well.", "Hey! How's it going?", "I hereby wish to inform you of the following."),
    purpose: existingSet("purpose", "I am writing to tell you about this situation.", "I am writing about an unrelated matter.", "I am writing to complain about the weather."),
    context: existingSet("filler", formal ? "I would like to explain the situation so that you have the necessary background." : "I thought I should explain what happened so you know the full story.", "This has nothing to do with the event.", "I have lots of homework tonight."),
    keyinfo1: existingSet("keyinfo1", pts[0] || "The first important detail is included in the notice.", "The first detail is not needed.", "The first detail is completely different."),
    keyinfo2: existingSet("keyinfo2", pts[1] || "The second important detail is included in the notice.", "The second detail is not needed.", "The second detail is completely different."),
    keyinfo3: existingSet("keyinfo3", pts[2] || "The third important detail is included in the notice.", "The third detail is not needed.", "The third detail is completely different."),
    keyinfo4: existingSet("keyinfo4", pts[3] || "The fourth important detail is included in the notice.", "The fourth detail is not needed.", "The fourth detail is completely different."),
    keyinfo5: existingSet("keyinfo5", pts[4] || "The fifth important detail is included in the notice.", "The fifth detail is not needed.", "The fifth detail is completely different."),
    ownIdea: { correct: full.ownContentKeywords?.[0]?.[0] || "suggest a helpful idea", distractors: [full.ownContentKeywords?.[1]?.[0] || "offer another practical way to help", full.ownContentKeywords?.[2]?.[0] || "contribute in another suitable way"] },
    closing: existingSet("closing", formal ? "Thank you for considering my suggestion." : "Hope to hear from you soon!", "This is the end of an unrelated topic.", "I am not sure what else to say."),
    signoff: existingSet("signoff", formal ? "Yours sincerely," : "Best,", "Yours faithfully,", "Love and hugs forever,"),
    name: { correct: formal ? "Wei Ming Tan" : "Wei Ming", distractors: [formal ? "Wei Ming" : "Wei Ming Tan", "Mr Tan"] },
  };
  const builds = FIXED_COMPONENT_KEYS.map(key => buildOptionComponent(key, COMPONENT_LABELS(key, formal), sets[key]));
  full.components = builds.map(({correctId, ...c}) => c);
  full.answerKey = { components: Object.fromEntries(builds.map(c => [c.key, c.correctId])), paragraphBreaks: full.answerKey?.paragraphBreaks || ["purpose", "keyinfo1", "closing", "signoff"] };
  return full;
}

async function findFullCase(env, id) {
  const demo = DEMO_CASES.find((c) => c.id === id);
  if (demo) return demo;
  const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(id).first();
  if (!row) return null;
  return fullCaseFromRow(row);
}

// ---------- student access / case listing ----------

async function ensureSettingsTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
}

/** Shared read for a boolean app_settings flag. Fails open (returns
 * `defaultValue`) if the settings table isn't migrated yet, matching the
 * existing student-access behavior — a missing table should never
 * accidentally lock pupils out. */
async function isAppSettingEnabled(env, key, defaultValue) {
  try {
    await ensureSettingsTable(env);
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first();
    return row ? row.value !== "0" : defaultValue;
  } catch (e) { return defaultValue; }
}

async function setAppSettingEnabled(env, key, enabled) {
  await ensureSettingsTable(env);
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, enabled ? "1" : "0").run();
}

async function isStudentAccessEnabled(env) {
  return isAppSettingEnabled(env, "student_access_enabled", true);
}

async function getStudentAccessSetting(env) { return json({ enabled: await isStudentAccessEnabled(env) }); }

async function setStudentAccessSetting(env, request, session) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
  try {
    await setAppSettingEnabled(env, "student_access_enabled", body.enabled);
    return json({ enabled: body.enabled, changedBy: session.username });
  } catch (e) { return json({ error: "Could not save student access setting. Run schema.sql against the D1 database." }, 500); }
}

/** Separate, narrower switch from student_access_enabled above: this one
 * only hides the two built-in tutorial/sample cases (see demoCases.js)
 * from pupils, while leaving any teacher-uploaded published cases
 * visible as normal. Useful once a class has outgrown the tutorial
 * cases and a teacher wants the case list to only show real practice
 * material. Defaults to enabled (tutorial cases visible), matching
 * today's behavior for anyone who hasn't touched this setting. */
async function isTutorialCasesEnabled(env) {
  return isAppSettingEnabled(env, "tutorial_cases_enabled", true);
}

async function getTutorialAccessSetting(env) { return json({ enabled: await isTutorialCasesEnabled(env) }); }

async function setTutorialAccessSetting(env, request, session) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
  try {
    await setAppSettingEnabled(env, "tutorial_cases_enabled", body.enabled);
    return json({ enabled: body.enabled, changedBy: session.username });
  } catch (e) { return json({ error: "Could not save tutorial access setting. Run schema.sql against the D1 database." }, 500); }
}

// ---------- case listing / retrieval ----------

async function listCases(env) {
  if (!(await isStudentAccessEnabled(env))) return json({ cases: [], studentAccessEnabled: false });
  const tutorialCasesEnabled = await isTutorialCasesEnabled(env);
  const demoList = tutorialCasesEnabled
    ? DEMO_CASES.map((c) => ({ id: c.id, title: c.title, formal: c.formal, imageData: c.imageData, builtin: true }))
    : [];
  let dbList = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, title, formal, image_data FROM cases WHERE status = 'published' ORDER BY created_at DESC"
    ).all();
    dbList = (results || []).map((r) => ({
      id: r.id, title: r.title, formal: !!r.formal, imageData: r.image_data, builtin: false,
    }));
  } catch (e) { /* DB might not be migrated yet — demo cases still work */ }
  return json({ cases: [...demoList, ...dbList], tutorialCasesEnabled });
}

/** A demo/tutorial case id (see demoCases.js) is only playable while the
 * tutorial-cases toggle is on. Teacher-uploaded cases are never affected
 * by this check. */
async function isBlockedTutorialCase(env, id) {
  return DEMO_CASES.some((c) => c.id === id) && !(await isTutorialCasesEnabled(env));
}

async function getCase(env, id) {
  if (!(await isStudentAccessEnabled(env))) return json({ error: "Student access is currently disabled." }, 403);
  if (await isBlockedTutorialCase(env, id)) return json({ error: "Tutorial cases are currently disabled." }, 403);
  const full = await findFullCase(env, id);
  if (!full) return json({ error: "Case not found" }, 404);
  return json({ case: toPublicCase(full) });
}

// ---------- scoring ----------

async function submitCase(env, request, id) {
  if (!(await isStudentAccessEnabled(env))) return json({ error: "Student access is currently disabled." }, 403);
  if (await isBlockedTutorialCase(env, id)) return json({ error: "Tutorial cases are currently disabled." }, 403);
  const full = await findFullCase(env, id);
  if (!full) return json({ error: "Case not found" }, 404);
  const body = await request.json();
  const name = (body.name || "Anonymous Detective").toString().slice(0, 40);
  const playerClass = (body.playerClass || "").toString().slice(0, 20).trim().toUpperCase();
  // A random id generated once in the pupil's browser (see index.html) —
  // disambiguates two same-named pupils in the same class so their
  // scores don't merge into one row on the heatmap/misconceptions view.
  const deviceId = (body.deviceId || "").toString().trim().slice(0, 40);
  const isFormal = full.formal !== undefined ? !!full.formal : true;

  // A formal letter is signed off with a full name; an informal note only
  // needs a first name. Validated server-side too, since the client check
  // is just a UX nicety and shouldn't be the only thing enforcing it.
  const signOffName = (body.signOffName || "").toString().trim().slice(0, 60);
  const signOffWordCount = signOffName ? signOffName.split(/\s+/).filter(Boolean).length : 0;
  if (!signOffName || (isFormal && signOffWordCount < 2)) {
    return json({ error: isFormal ? "Please sign off with your first and last name." : "Please sign off with your first name." }, 400);
  }

  const rubric = await getRubric(env);
  const w = rubric.weights;
  const total_max = rubric.total;
  const breakdown = {};

  // 1) Task ID — purpose / audience / context
  const taskAnswers = body.taskAnswers || {}; // { chunkId: "purpose"|"audience"|"context"|"other" }
  let taskScore = 0;
  const targets = ["purpose", "audience", "context"];
  const perTarget = w.taskIdentification / targets.length;
  for (const t of targets) {
    const correctChunk = full.taskChunks.find((c) => c.type === t);
    if (correctChunk && taskAnswers[correctChunk.id] === t) taskScore += perTarget;
  }
  breakdown.taskIdentification = { score: Math.round(taskScore), max: w.taskIdentification };

  // 2) Stimulus key info
  const stimulusSelected = new Set(body.stimulusSelected || []);
  const relevantIds = full.stimulusPoints.filter((p) => p.relevant).map((p) => p.id);
  const irrelevantIds = full.stimulusPoints.filter((p) => !p.relevant).map((p) => p.id);
  let correctPicks = 0, wrongPicks = 0;
  for (const id2 of stimulusSelected) {
    if (relevantIds.includes(id2)) correctPicks++;
    else if (irrelevantIds.includes(id2)) wrongPicks++;
  }
  const penaltyPerWrong = w.stimulusKeyInfo * 0.15;
  const stimulusRaw = relevantIds.length
    ? (correctPicks / relevantIds.length) * w.stimulusKeyInfo - wrongPicks * penaltyPerWrong
    : 0;
  const stimulusScore = Math.max(0, Math.round(stimulusRaw));
  breakdown.stimulusKeyInfo = { score: Math.min(w.stimulusKeyInfo, stimulusScore), max: w.stimulusKeyInfo };

  // 3) Letter component MCQs (proportional)
  const componentChoices = body.componentChoices || {}; // { key: optionId | "custom" }
  const componentResponses = body.componentResponses || {}; // { key: typed response }
  const compKeys = Object.keys(full.answerKey.components || {});
  let compCorrect = 0;
  for (const key of compKeys) {
    const expected = full.answerKey.components[key];
    if (componentChoices[key] === expected) {
      compCorrect++;
      continue;
    }
    if (componentChoices[key] === "custom") {
      const typed = String(componentResponses[key] || "").trim();
      const comp = full.components.find((c) => c.key === key);
      const correctText = comp?.options?.find((o) => o.id === expected)?.text || "";
      const sim = jaccardSimilarity(typed, correctText);
      if (typed && (sim >= 0.45 || (key === "ownIdea" && scoreOwnContentByKeyword(typed, full.ownContentKeywords, 1) >= 0.5))) compCorrect++;
    }
  }
  const compScore = compKeys.length ? Math.round((compCorrect / compKeys.length) * w.letterChoices) : 0;
  breakdown.letterChoices = { score: compScore, max: w.letterChoices, correctCount: compCorrect, total: compKeys.length };

  // 4) Paragraphing
  const paragraphBreaks = new Set(body.paragraphBreaks || []); // component keys that START a new paragraph
  const correctBreaks = new Set(full.answerKey.paragraphBreaks || []);
  let paraHits = 0;
  const allKeys = full.components.map((c) => c.key);
  for (const key of allKeys) {
    const guessed = paragraphBreaks.has(key);
    const actual = correctBreaks.has(key);
    if (guessed === actual) paraHits++;
  }
  const paraScore = Math.round((paraHits / allKeys.length) * w.paragraphing);
  breakdown.paragraphing = { score: paraScore, max: w.paragraphing };

  // 5) Own content plausibility — keyword match, AI-assisted when ambiguous
  const ownContent = (body.ownContent || "").toString().slice(0, 500);
  const ownKeywordScore = scoreOwnContentByKeyword(ownContent, full.ownContentKeywords, w.ownContent);
  const ownRatio = w.ownContent > 0 ? ownKeywordScore / w.ownContent : 0;
  // Only call the AI marker when the deterministic score is genuinely
  // ambiguous (neither confidently low nor confidently high) — at the
  // extremes the AI is unlikely to change the score enough to justify
  // the extra latency and provider load.
  const ownNeedsAi = ownContent.trim().length > 0 && ownRatio > 0.15 && ownRatio < 0.85;

  // 6) AI holistic read of the assembled letter vs model answer
  const assembledLetter = assembleLetter(full, componentChoices, paragraphBreaks, signOffName, componentResponses);
  const holisticFallbackScore = Math.round(jaccardSimilarity(assembledLetter, full.model_letter) * w.overallQuality);
  const holisticRatio = w.overallQuality > 0 ? holisticFallbackScore / w.overallQuality : 0;
  const holisticNeedsAi = holisticRatio > 0.15 && holisticRatio < 0.85;

  // Run both AI markers in parallel (instead of one after another) — this
  // is the pupil-facing latency-sensitive path, so waiting for two
  // independent calls sequentially would roughly double how long they
  // stare at a spinner after clicking submit for no benefit.
  const [ownAiResult, holisticAiResult] = await Promise.all([
    ownNeedsAi ? aiJudgeOwnContent(env, full, ownContent, w.ownContent).catch(() => null) : Promise.resolve(null),
    holisticNeedsAi ? aiHolisticMark(env, full, assembledLetter, w.overallQuality).catch(() => null) : Promise.resolve(null),
  ]);

  const ownScore = ownAiResult ? ownAiResult.score : ownKeywordScore;
  breakdown.ownContent = { score: ownScore, max: w.ownContent, aiNote: ownAiResult ? ownAiResult.note : null };

  const holisticScore = holisticAiResult ? holisticAiResult.score : holisticFallbackScore;
  breakdown.overallQuality = { score: holisticScore, max: w.overallQuality, aiNote: holisticAiResult ? holisticAiResult.note : null };

  const total = Object.values(breakdown).reduce((s, b) => s + b.score, 0);

  // Below mastery threshold: ask the AI marker for a stronger rewrite the
  // pupil can learn from, alongside a couple of specific, encouraging tips.
  let improvement = null;
  if (total < rubric.masteryThreshold) {
    try {
      improvement = await aiGenerateStrongerVersion(env, full, assembledLetter, ownContent, total, total_max, rubric.masteryThreshold);
    } catch (e) { /* no improvement offered if every AI provider is unavailable */ }
  }

  try {
    await env.DB.prepare(
      "INSERT INTO leaderboard (player_name, player_class, case_id, case_title, score, max_score, breakdown, device_id) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(name, playerClass, full.id, full.title, total, total_max, JSON.stringify(breakdown), deviceId).run();
  } catch (e) { /* leaderboard table may not be migrated; still return the score */ }

  // Record each MCQ pick (one row per component) so the admin dashboard
  // can surface class-wide misconceptions later — best-effort, never
  // blocks the pupil's result if the table isn't migrated yet.
  try {
    const pickStmts = compKeys
      .filter((key) => componentChoices[key])
      .map((key) => env.DB.prepare(
        "INSERT INTO option_picks (case_id, case_title, component_key, option_id, player_class) VALUES (?,?,?,?,?)"
      ).bind(full.id, full.title, key, componentChoices[key], playerClass));
    if (pickStmts.length) await env.DB.batch(pickStmts);
  } catch (e) { /* option_picks table may not be migrated; safe to skip */ }

  return json({
    score: total, max: total_max, threshold: rubric.masteryThreshold, breakdown,
    assembledLetter, modelLetter: full.model_letter, improvement,
  });
}

function scoreOwnContentByKeyword(text, keywordGroups, max) {
  if (!keywordGroups || !keywordGroups.length) return text.trim().length > 10 ? Math.round(max * 0.53) : 0;
  const lower = text.toLowerCase();
  const hitGroups = keywordGroups.filter((group) => group.some((kw) => lower.includes(kw.toLowerCase())));
  const ratio = hitGroups.length / keywordGroups.length;
  return Math.round(Math.min(1, ratio + (text.trim().length > 15 ? 0.15 : 0)) * max);
}

function assembleLetter(full, componentChoices, paragraphBreaksSet, signOffName, componentResponses = {}) {
  let out = "";
  for (const comp of full.components) {
    const chosenId = componentChoices[comp.key];
    const opt = comp.options.find((o) => o.id === chosenId);
    const text = chosenId === "custom" ? String(componentResponses[comp.key] || "").trim() : (opt ? opt.text : "");
    if (!text) continue;
    if (paragraphBreaksSet.has(comp.key) && out.length) out += "\n\n";
    else if (out.length) out += " ";
    out += text;
  }
  if (signOffName) out += (out.length ? "\n" : "") + signOffName;
  return out.trim();
}

function jaccardSimilarity(a, b) {
  const tok = (s) => new Set(s.toLowerCase().match(/[a-z']+/g) || []);
  const A = tok(a), B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

// ---------- AI provider chain (all optional / best-effort) ----------
//
// callAI() is the single entry point every AI-assisted feature uses. It
// tries each provider in order and returns the first successful response.
// A provider is silently skipped (not an error) if its secret isn't
// configured, so the chain degrades all the way to Workers AI, and finally
// to `null` (callers fall back to deterministic scoring) if none work.

/** Model IDs eligible for OpenRouter's zero-cost tier: either the
 * "openrouter/free" router (which auto-selects a free model per request,
 * see https://openrouter.ai/openrouter/free) or any model ID ending in
 * the ":free" variant suffix. Anything else is a paid model. */
function isFreeOpenRouterModel(model) {
  return model === "openrouter/free" || /:free$/.test(model);
}

async function callOpenRouter(env, prompt, maxTokens) {
  const key = env.OPENROUTER_API_KEY;
  if (!key) return null;
  // Default to OpenRouter's Free Models Router, which randomly selects a
  // free model per request (filtered to whatever the request needs) —
  // this can never incur a charge. If OPENROUTER_MODEL is overridden to
  // anything that ISN'T "openrouter/free" or a ":free"-suffixed model
  // id, silently fall back to "openrouter/free" instead — the intent of
  // this deployment is to only ever call free OpenRouter inference,
  // never to risk an accidental paid model slipping in via a secret.
  const requestedModel = env.OPENROUTER_MODEL || "openrouter/free";
  const model = isFreeOpenRouterModel(requestedModel) ? requestedModel : "openrouter/free";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://boss-theres-a-situation.workers.dev",
      "X-Title": "Boss! There's a situation!",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error("OpenRouter error " + res.status);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || null;
}

async function callGroq(env, prompt, maxTokens) {
  const key = env.GROQ_API_KEY;
  if (!key) return null;
  // llama-3.1-8b-instant was deprecated by Groq on 2026-06-17 and
  // decommissioned 2026-08-16; openai/gpt-oss-20b is Groq's own
  // recommended replacement and remains available on Groq's free tier
  // (which — per Groq's pricing page — includes every model with no
  // credit card required, just rate-limited).
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.GROQ_MODEL || "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error("Groq error " + res.status);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || null;
}

async function callGemini(env, prompt, maxTokens) {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  // gemini-1.5-flash has been fully discontinued by Google. As of
  // April 2026, Google's free tier only covers Flash and Flash-Lite
  // models (Pro models are paid-only) — gemini-2.5-flash-lite is the
  // current GA model matching that free-tier eligibility.
  const model = env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    }
  );
  if (!res.ok) throw new Error("Gemini error " + res.status);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function callWorkersAIText(env, prompt, maxTokens) {
  if (!env.AI) return null;
  const res = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
  });
  return res?.response || res?.result || null;
}

/** Races a promise against a timeout so a hung provider can't stall the
 * whole fallback chain — after `ms`, this rejects and callAI moves on to
 * the next provider (the original call may still finish in the
 * background on Workers AI, but we no longer wait on it). */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`AI provider timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/** Best-effort write to ai_call_log — never throws, never blocks on
 * failure. Adds a small amount of latency to each provider attempt in
 * exchange for visibility into which provider is actually answering
 * (see adminAiHealth) — acceptable since it's one indexed insert. */
async function logAiCall(env, provider, ok) {
  try {
    await env.DB.prepare("INSERT INTO ai_call_log (provider, ok) VALUES (?,?)").bind(provider, ok ? 1 : 0).run();
  } catch (e) { /* ai_call_log table not migrated yet — logging is best-effort */ }
}

/** Try OpenRouter, then Groq, then Gemini, then Workers AI. Returns the
 * raw text response from whichever provider answers first, or null. Each
 * provider gets at most AI_TIMEOUT_MS before we give up on it and try
 * the next, so a slow/hanging provider degrades gracefully instead of
 * blocking the whole chain (and the pupil's submit button). Every
 * attempt (success or failure) is logged to ai_call_log so the admin
 * dashboard can show real provider health instead of a black box. */
async function callAI(env, prompt, maxTokens = 500) {
  const providers = [
    ["openrouter", callOpenRouter, !!env.OPENROUTER_API_KEY],
    ["groq", callGroq, !!env.GROQ_API_KEY],
    ["gemini", callGemini, !!env.GEMINI_API_KEY],
    ["workers-ai", callWorkersAIText, !!env.AI],
  ];
  for (const [providerName, provider, configured] of providers) {
    if (!configured) continue; // not set up at all — skip silently, don't count as a "failure"
    try {
      const text = await withTimeout(provider(env, prompt, maxTokens), AI_TIMEOUT_MS);
      if (text) { await logAiCall(env, providerName, true); return text; }
      await logAiCall(env, providerName, false);
    } catch (e) {
      await logAiCall(env, providerName, false);
      /* this provider failed, errored, or timed out — try the next one */
    }
  }
  return null;
}

function parseAiJson(text) {
  if (!text) return null;
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) { return null; }
}

async function aiJudgeOwnContent(env, full, ownContent, maxScore) {
  const prompt = `You are marking a Singapore PSLE English situational writing "own content" idea.
Task: ${full.task_text || full.taskText}
Question pupils were asked: ${full.own_content_prompt || full.ownContentPrompt}
Pupil's suggestion: "${ownContent}"

Judge only whether this is a PLAUSIBLE, relevant idea for the scenario (not grammar).
Reply with strict JSON only: {"score": <0-${maxScore} integer>, "note": "<one short encouraging sentence of feedback, under 20 words>"}`;
  const text = await callAI(env, prompt, 150);
  const obj = parseAiJson(text);
  if (!obj || typeof obj.score !== "number") return null;
  obj.score = Math.max(0, Math.min(maxScore, Math.round(obj.score)));
  return obj;
}

async function aiHolisticMark(env, full, assembledLetter, maxScore) {
  const prompt = `You are an AI teaching assistant marking a Singapore PSLE English situational writing letter.
Model/reference answer:
"""${full.model_letter}"""

Pupil's assembled letter:
"""${assembledLetter}"""

Score the pupil's letter out of ${maxScore} for overall content coverage, appropriate register/tone, and coherence, compared to the model answer. Reply with strict JSON only: {"score": <0-${maxScore} integer>, "note": "<one short encouraging sentence of feedback, under 20 words>"}`;
  const text = await callAI(env, prompt, 150);
  const obj = parseAiJson(text);
  if (!obj || typeof obj.score !== "number") return null;
  obj.score = Math.max(0, Math.min(maxScore, Math.round(obj.score)));
  return obj;
}

/** Called when a submission scores below the mastery threshold. Asks the
 * AI marker for a stronger rewrite of the pupil's own letter (keeping
 * their own-content idea and voice where possible) plus a couple of
 * specific, encouraging tips. Returns null if no AI provider is available. */
async function aiGenerateStrongerVersion(env, full, assembledLetter, ownContent, score, maxScore, threshold) {
  const prompt = `You are an encouraging PSLE English writing coach helping a Primary 6 pupil improve their situational writing.
Task: ${full.task_text || full.taskText}
Register: ${(full.formal !== undefined ? full.formal : true) ? "formal" : "informal"}
Model/reference answer:
"""${full.model_letter}"""
Pupil's own suggested idea: "${ownContent || "(none given)"}"
Pupil's letter (scored ${score}/${maxScore}, below the ${threshold}-point mastery threshold):
"""${assembledLetter || "(the pupil did not complete a letter)"}"""

Write a STRONGER version of the pupil's letter: keep their own idea and voice where sensible, but fix structure, register, missing content, and flow so it would score well against the model answer. Then give 2-3 short, specific, encouraging tips (each under 20 words) on what changed and why.
Reply with strict JSON only: {"improvedLetter": "<full improved letter, use \\n\\n between paragraphs>", "tips": ["<tip 1>", "<tip 2>"]}`;
  const text = await callAI(env, prompt, 700);
  const obj = parseAiJson(text);
  if (!obj || !obj.improvedLetter) return null;
  return { improvedLetter: obj.improvedLetter, tips: Array.isArray(obj.tips) ? obj.tips.slice(0, 3) : [] };
}

// ---------- leaderboard ----------

async function getLeaderboard(env, url) {
  const limit = Math.min(50, Number(url.searchParams.get("limit")) || 20);
  try {
    const { results } = await env.DB.prepare(
      "SELECT player_name, case_title, score, created_at FROM leaderboard ORDER BY score DESC, created_at ASC LIMIT ?"
    ).bind(limit).all();
    return json({ leaderboard: results || [] });
  } catch (e) {
    return json({ leaderboard: [], note: "Leaderboard table not migrated yet — run schema.sql against your D1 database." });
  }
}

/**
 * Spaced review: a case is "due" for a pupil if their most recent attempt
 * scored below the CURRENT mastery threshold and enough time has passed
 * since that attempt (REVIEW_COOLDOWN_HOURS) — simple time-boxed spacing
 * rather than a full SM-2 scheduler, but enough to stop the game being
 * purely "pick whatever looks fun" and nudge pupils back to what they
 * haven't mastered yet, after a delay rather than in an immediate loop.
 */
async function getPracticeDue(env, url) {
  if (!(await isStudentAccessEnabled(env))) return json({ due: [], disabled: true });
  const name = (url.searchParams.get("name") || "").toString().trim().slice(0, 40);
  const playerClass = (url.searchParams.get("playerClass") || "").toString().trim().slice(0, 20).toUpperCase();
  const deviceId = (url.searchParams.get("deviceId") || "").toString().trim().slice(0, 40);
  if (!name) return json({ due: [] });

  const rubric = await getRubric(env);
  let rows = [];
  try {
    // Filter by device_id too when the client supplies one, so two
    // same-named pupils in the same class don't see each other's due
    // list merged together. Falls back to name+class alone for older
    // clients/cached pages that haven't picked up a deviceId yet.
    const query = deviceId
      ? `SELECT case_id, case_title, score, max_score, created_at FROM leaderboard
         WHERE player_name = ? AND player_class = ? AND device_id = ? ORDER BY created_at DESC`
      : `SELECT case_id, case_title, score, max_score, created_at FROM leaderboard
         WHERE player_name = ? AND player_class = ? ORDER BY created_at DESC`;
    const stmt = deviceId ? env.DB.prepare(query).bind(name, playerClass, deviceId) : env.DB.prepare(query).bind(name, playerClass);
    const { results } = await stmt.all();
    rows = results || [];
  } catch (e) {
    return json({ due: [] });
  }

  const latestByCase = new Map();
  for (const r of rows) if (!latestByCase.has(r.case_id)) latestByCase.set(r.case_id, r);

  const tutorialCasesEnabled = await isTutorialCasesEnabled(env);
  const now = Date.now();
  const cooldownMs = REVIEW_COOLDOWN_HOURS * 60 * 60 * 1000;
  const due = [];
  for (const r of latestByCase.values()) {
    if (r.score >= rubric.masteryThreshold) continue; // already mastered — nothing to resurface
    // Don't resurface a tutorial case the pupil can no longer open.
    if (!tutorialCasesEnabled && DEMO_CASES.some((c) => c.id === r.case_id)) continue;
    const lastPlayedMs = new Date(r.created_at.replace(" ", "T") + "Z").getTime();
    if (!Number.isFinite(lastPlayedMs) || now - lastPlayedMs >= cooldownMs) {
      due.push({ caseId: r.case_id, caseTitle: r.case_title, lastScore: r.score, max: r.max_score, lastPlayed: r.created_at });
    }
  }
  return json({ due, cooldownHours: REVIEW_COOLDOWN_HOURS, masteryThreshold: rubric.masteryThreshold });
}

/** Pupil-facing "My Scores" — their own attempt history, most recent first. */
async function getMyScores(env, url) {
  const name = (url.searchParams.get("name") || "").toString().trim().slice(0, 40);
  const playerClass = (url.searchParams.get("playerClass") || "").toString().trim().slice(0, 20).toUpperCase();
  const deviceId = (url.searchParams.get("deviceId") || "").toString().trim().slice(0, 40);
  if (!name) return json({ scores: [] });
  try {
    const query = deviceId
      ? `SELECT case_title, score, max_score, created_at FROM leaderboard
         WHERE player_name = ? AND player_class = ? AND device_id = ? ORDER BY created_at DESC LIMIT 30`
      : `SELECT case_title, score, max_score, created_at FROM leaderboard
         WHERE player_name = ? AND player_class = ? ORDER BY created_at DESC LIMIT 30`;
    const stmt = deviceId ? env.DB.prepare(query).bind(name, playerClass, deviceId) : env.DB.prepare(query).bind(name, playerClass);
    const { results } = await stmt.all();
    return json({ scores: results || [] });
  } catch (e) {
    return json({ scores: [] });
  }
}

// ---------- admin: case management ----------

async function adminListCases(env) {
  const { results } = await env.DB.prepare("SELECT * FROM cases ORDER BY created_at DESC").all();
  return json({ cases: (results || []).map(fullCaseFromRow) });
}

async function adminDeleteCase(env, id) {
  await env.DB.prepare("DELETE FROM cases WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

/** Review gate: a freshly AI-built case starts as a draft (see
 * adminCreateCase) and is invisible to pupils until a teacher/admin
 * explicitly publishes it here. Records who approved it and when,
 * separately from who originally built it (created_by), since a
 * different teacher may review someone else's draft. */
async function adminPublishCase(env, id, session) {
  const row = await env.DB.prepare("SELECT id, status FROM cases WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Case not found" }, 404);
  if (row.status === "published") return json({ ok: true, alreadyPublished: true });
  const approvedAt = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE cases SET status = 'published', approved_by = ?, approved_at = ? WHERE id = ?"
  ).bind(session.username, approvedAt, id).run();
  return json({ ok: true, approvedBy: session.username, approvedAt });
}

/**
 * Teacher submits: title, imageData (base64), taskText, formal (bool),
 * keyInfo (array of short strings), ownContentPrompt, ownContentIdeas
 * (array of short strings, acceptable answers), modelLetter (full text).
 * The Worker uses the AI provider chain (OpenRouter -> Groq -> Gemini ->
 * Workers AI) to turn this into a playable case: task chunks
 * (purpose/audience/context tagging), distractor stimulus points, MCQ
 * letter-building options (1 correct + 3 distractors per component),
 * paragraph answer key, and keyword groups for own-content marking.
 * If no provider is reachable, a rule-based fallback is used so the
 * case is still playable (just less varied distractors).
 *
 * The case is always created as a DRAFT — never immediately visible to
 * pupils — since the content is machine-generated and the teacher
 * hasn't reviewed the JSON preview yet at the point of creation. A
 * separate explicit "Publish" action (adminPublishCase) makes it live,
 * and records who approved it.
 */
async function saveBuiltCase(env, body, session, built, meta = {}) {
  const id = newId("case");
  await env.DB.prepare(
    `INSERT INTO cases (id, title, image_data, task_text, task_chunks, formal, stimulus_points, own_content_prompt, own_content_keywords, components, answer_key, model_letter, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, body.title, body.imageData || null, body.taskText, JSON.stringify(built.taskChunks), body.formal ? 1 : 0,
    JSON.stringify(built.stimulusPoints), body.ownContentPrompt || "", JSON.stringify(built.ownContentKeywords || []),
    JSON.stringify(built.components), JSON.stringify(built.answerKey), body.modelLetter, "draft", session.username
  ).run();
  return { id, built, ...meta, status: "draft" };
}

async function adminCreateCase(env, request, session) {
  const body = await request.json().catch(() => ({}));
  const required = ["title", "taskText", "keyInfo", "modelLetter"];
  for (const f of required) {
    if (!body[f] || (Array.isArray(body[f]) && body[f].length < 5)) return json({ error: `Missing field: ${f}` }, 400);
  }
  const formal = !!body.formal;
  try {
    const result = await aiBuildCase(env, body, formal);
    return json(await saveBuiltCase(env, body, session, result.built, {
      aiUsed: result.allAiUsed, anyAiUsed: result.anyAiUsed, aiDetail: result.aiDetail, usedManualFallback: false,
    }));
  } catch (e) {
    const fallback = buildManualFallbackCase(body, formal);
    return json(await saveBuiltCase(env, body, session, fallback, {
      aiUsed: false, anyAiUsed: false, aiDetail: { failed: true, error: String(e?.message || e) }, usedManualFallback: true,
    }));
  }
}

async function adminCreateManualCase(env, request, session) {
  const body = await request.json().catch(() => ({}));
  const required = ["title", "taskText", "keyInfo", "modelLetter", "components"];
  for (const f of required) {
    if (!body[f] || (Array.isArray(body[f]) && body[f].length === 0)) return json({ error: `Missing field: ${f}` }, 400);
  }
  if (!Array.isArray(body.keyInfo) || body.keyInfo.length !== 5 || body.keyInfo.some((s) => typeof s !== "string" || !s.trim())) {
    return json({ error: "keyInfo must contain exactly 5 non-empty strings." }, 400);
  }
  if (!Array.isArray(body.components) || body.components.length !== FIXED_COMPONENT_KEYS.length) return json({ error: "Manual case must contain exactly 13 parts." }, 400);
  for (let i = 0; i < body.components.length; i++) {
    const c = body.components[i];
    const opts = Array.isArray(c?.options) ? c.options.filter((o) => o && typeof o.text === "string" && o.text.trim()) : [];
    if (opts.length !== 3) return json({ error: `Part ${i + 1} (${FIXED_COMPONENT_KEYS[i]}) must have exactly 3 non-empty options.` }, 400);
    if (!["a", "b", "c"].includes(c.correctId)) return json({ error: `Part ${i + 1} (${FIXED_COMPONENT_KEYS[i]}) needs a correctId of "a", "b" or "c".` }, 400);
  }
  const built = buildManualCaseFromComponents(body, !!body.formal, body.components);
  return json(await saveBuiltCase(env, body, session, built, { aiUsed: false, anyAiUsed: false, aiDetail: {}, usedManualFallback: true, manual: true }));
}

/**
 * Regenerate just ONE piece of an already-built case — e.g. a teacher
 * likes everything except the "purpose" MCQ, or one key-info distractor
 * set reads oddly. Re-runs the same small, focused AI call that piece
 * used during the original build (see aiBuildCase) and writes only the
 * affected column(s) back, rather than rebuilding the whole case.
 *
 * `part` is one of: "taskChunks", "stimulus", "ownContentKeywords",
 * "purpose", "filler", or "keyinfoN" (matching that component's key).
 */
async function adminUpdateCaseImage(env, request, caseId, session) {
  const body = await request.json().catch(() => ({}));
  const imageData = String(body.imageData || "");
  if (!imageData) return json({ error: "imageData is required" }, 400);
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(imageData)) {
    return json({ error: "Unsupported image format. Use PNG, JPEG, WebP or GIF." }, 400);
  }
  if (imageData.length > 760000) return json({ error: "Image is too large. Keep it below about 500 KB before upload." }, 413);
  const row = await env.DB.prepare("SELECT id FROM cases WHERE id = ?").bind(caseId).first();
  if (!row) return json({ error: "Case not found" }, 404);
  await env.DB.prepare("UPDATE cases SET image_data = ?, status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?").bind(imageData, caseId).run();
  return json({ ok: true, caseId, savedBy: session.username, status: "draft" });
}

async function adminSaveCaseComponents(env, request, caseId, session) {
  const body = await request.json().catch(() => ({}));
  const components = Array.isArray(body.components) ? body.components : [];
  const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(caseId).first();
  if (!row) return json({ error: "Case not found" }, 404);
  if (components.length !== 13) return json({ error: "Exactly 13 draft components are required." }, 400);
  const clean = [];
  const answer = { components: {}, paragraphBreaks: JSON.parse(row.answer_key || "{}")?.paragraphBreaks || [] };
  for (const c of components) {
    if (!c || !c.key || !c.label || !Array.isArray(c.options) || c.options.length !== 3 || c.options.some((o) => !o || !String(o.text || "").trim())) {
      return json({ error: "Each component needs a key, label, and exactly 3 non-empty options." }, 400);
    }
    const options = c.options.map((o, i) => ({ id: String.fromCharCode(97 + i), text: String(o.text).trim().slice(0, 500) }));
    const correctId = String(c.correctId || "a");
    if (!options.some((o) => o.id === correctId)) return json({ error: `Invalid correct option for ${c.key}.` }, 400);
    clean.push({ key: String(c.key), label: String(c.label).slice(0, 120), options });
    answer.components[String(c.key)] = correctId;
  }
  const keys = clean.map((c) => c.key);
  if (new Set(keys).size !== 13 || JSON.stringify(keys) !== JSON.stringify(FIXED_COMPONENT_KEYS)) {
    return json({ error: "Components must be in the standard 13-part order." }, 400);
  }
  await env.DB.prepare("UPDATE cases SET components = ?, answer_key = ?, status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?")
    .bind(JSON.stringify(clean), JSON.stringify(answer), caseId).run();
  return json({ ok: true, savedBy: session.username, components: clean, answerKey: answer });
}

async function adminRegenerateCasePart(env, request, caseId) {
  const body = await request.json().catch(() => ({}));
  const part = (body.part || "").toString();
  const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(caseId).first();
  if (!row) return json({ error: "Case not found" }, 404);
  const full = fullCaseFromRow(row);
  if (FIXED_COMPONENT_KEYS.includes(part)) {
    const generated = await aiSingleComponent(env, part, full, !!row.formal);
    const current = full.components.find((c) => c.key === part);
    const label = current?.label || COMPONENT_LABELS(part, !!row.formal);
    const newComp = buildOptionComponent(part, label, generated || fallbackComponentSet(part, full, !!row.formal));
    full.components = full.components.map((c) => c.key === part ? { key: part, label, options: newComp.options } : c);
    full.answerKey.components[part] = newComp.correctId;
  } else if (part === "taskChunks") {
    full.taskChunks = (await aiTaskChunks(env, row.task_text)) || fallbackTaskChunks(row.task_text);
  } else if (part === "stimulus") {
    const keyInfo = full.stimulusPoints.filter((p) => p.relevant).map((p) => p.text);
    const extra = await aiStimulusDistractors(env, keyInfo, row.task_text);
    full.stimulusPoints = [...keyInfo.map((text, i) => ({ id: `s${i+1}`, text, relevant: true })), ...(extra || ["Extra flavour detail not required in your letter"]).map((text, i) => ({ id:`sx${i+1}`, text, relevant:false }))];
  } else if (part === "ownContentKeywords") {
    full.ownContentKeywords = (await aiOwnContentKeywords(env, row.own_content_prompt, null)) || full.ownContentKeywords || [];
  } else {
    return json({ error: `Unknown or non-regeneratable part: ${part}` }, 400);
  }
  await env.DB.prepare("UPDATE cases SET task_chunks = ?, stimulus_points = ?, own_content_keywords = ?, components = ?, answer_key = ?, status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?")
    .bind(JSON.stringify(full.taskChunks), JSON.stringify(full.stimulusPoints), JSON.stringify(full.ownContentKeywords), JSON.stringify(full.components), JSON.stringify(full.answerKey), caseId).run();
  return json({ ok: true, part, built: full });
}

async function adminAiHealth(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT provider, ok, COUNT(*) as n FROM ai_call_log
       WHERE created_at >= datetime('now', '-1 day')
       GROUP BY provider, ok
       ORDER BY provider`
    ).all();
    return json({ stats: results || [] });
  } catch (e) {
    return json({ stats: [], note: "ai_call_log table not migrated yet — run schema.sql against your D1 database." });
  }
}

/**
 * Build the full playable case structure using several SMALL, focused AI
 * calls instead of one large ~1800-token request for the entire nested
 * JSON. 8B-class models are reliable at "here's one small thing, return
 * one small JSON object" but frequently truncate or malform a big
 * multi-part schema in a single completion — which was silently falling
 * back to the generic rule-based builder for the WHOLE case even when
 * the model got 90% of it right.
 *
 * Each piece below is requested independently, validated on its own,
 * and — if that one piece fails or comes back malformed — falls back to
 * a deterministic template for just that piece, not the entire case.
 * `aiDetail` reports which pieces actually came from AI vs. fallback,
 * so the admin UI can show partial-success accurately instead of a
 * single all-or-nothing flag.
 */
const FIXED_COMPONENT_KEYS = [
  "salutation", "greeting", "purpose", "context", "keyinfo1", "keyinfo2", "keyinfo3", "keyinfo4", "keyinfo5", "ownIdea", "closing", "signoff", "name"
];

function COMPONENT_LABELS(key, formal) {
  return ({
    salutation: "Salutation (Audience)",
    greeting: formal ? "Introduction (formal)" : "Greeting (informal)",
    purpose: "Purpose",
    context: "Context",
    keyinfo1: "Key information 1", keyinfo2: "Key information 2", keyinfo3: "Key information 3", keyinfo4: "Key information 4", keyinfo5: "Key information 5",
    ownIdea: "Own idea",
    closing: "Closing sentence",
    signoff: "Sign-off",
    name: "Name",
  })[key] || key;
}

function normaliseComponentSet(set) {
  if (!set || typeof set.correct !== "string" || !Array.isArray(set.distractors)) return null;
  const distractors = set.distractors.filter((s) => typeof s === "string" && s.trim()).slice(0, 2);
  if (!set.correct.trim() || distractors.length < 2) return null;
  return { correct: set.correct.trim(), distractors };
}

async function aiSingleComponent(env, key, full, formal) {
  const taskText = full.taskText || full.task_text || "";
  const keyInfo = full.stimulusPoints.filter((p) => p.relevant).map((p) => p.text);
  let instruction = "";
  if (/^keyinfo\d+$/.test(key)) {
    const n = Number(key.replace("keyinfo", ""));
    const target = keyInfo[n - 1] || "Add a relevant detail from the task.";
    instruction = `The correct sentence must convey this required information: ${JSON.stringify(target)}`;
  } else if (key === "salutation") instruction = `Write a suitable salutation for the stated audience. Formal register: ${formal}.`;
  else if (key === "greeting") instruction = formal ? "Write a brief formal introductory sentence before the purpose, without repeating the purpose." : "Write a brief friendly informal greeting sentence before the purpose.";
  else if (key === "purpose") instruction = "Write the purpose of the letter clearly in one sentence.";
  else if (key === "context") instruction = "Write one concise sentence that gives the key situation/background the recipient needs.";
  else if (key === "ownIdea") instruction = `Suggest one strong pupil-generated idea answering: ${full.ownContentPrompt || full.own_content_prompt || "the own-content question"}.`;
  else if (key === "closing") instruction = formal ? "Write a polite formal closing sentence." : "Write a friendly informal closing sentence.";
  else if (key === "signoff") instruction = `Write the most appropriate sign-off phrase for a ${formal ? "formal" : "informal"} letter.`;
  else if (key === "name") instruction = `Provide a natural example ${formal ? "first-and-last" : "first"} name that can illustrate the required format. Do not add labels.`;
  else return null;
  const prompt = `PSLE Situational Writing. Task: "${taskText}"\nRegister: ${formal ? "FORMAL" : "INFORMAL"}.\nPart: ${COMPONENT_LABELS(key, formal)}.\n${instruction}\nReturn STRICT JSON only: {"correct":"...","distractors":["...","..."]}. The two distractors should be plausible but clearly less suitable/wrong for this exact part. Keep sentences pupil-friendly and concise.`;
  return normaliseComponentSet(await aiSmallJson(env, prompt, 260));
}

function fallbackComponentSet(key, full, formal) {
  if (key === "salutation") return fallbackSalutationSet(formal);
  if (key === "greeting") return formal ? { correct: "I hope you are well.", distractors: ["Hey! How's it going?", "What is up, everyone?"] } : { correct: "How are you? I hope you have been well.", distractors: ["Dear Sir/Madam, I write regarding this matter.", "I hereby wish to inform you of the following."] };
  if (key === "purpose") return fallbackPurposeSet(full.taskText || full.task_text || "You are writing to respond to the situation.");
  if (key === "context") return { correct: formal ? "I would like to explain the situation so that you have the necessary background." : "I thought I should explain what happened so you know the full story." , distractors: ["The weather has been strange lately.", "I have lots of homework to finish tonight."] };
  if (/^keyinfo\d+$/.test(key)) {
    const n = Number(key.replace("keyinfo", "")); const pts = full.stimulusPoints.filter((p) => p.relevant).map((p) => p.text); const correct = pts[n-1] || `The fifth detail is relevant to the situation.`;
    return { correct: correct.endsWith(".") ? correct : correct + ".", distractors: fallbackKeyInfoDistractors().slice(0,2) };
  }
  if (key === "ownIdea") {
    const groups = full.ownContentKeywords || []; const ideas = groups.slice(0,3).map((g) => g[0]).filter(Boolean);
    while (ideas.length < 3) ideas.push(["suggest a helpful idea", "offer another practical way to help", "contribute in another suitable way"][ideas.length]);
    return { correct: ideas[0], distractors: ideas.slice(1,3) };
  }
  if (key === "closing") return formal ? { correct: "Thank you for considering my suggestion.", distractors: ["See you around!", "Okay bye, talk later!"] } : { correct: "Hope to hear from you soon!", distractors: ["Thank you for your formal consideration of this correspondence.", "I await your written response in due course."] };
  if (key === "signoff") return fallbackSignoffSet(formal);
  if (key === "name") return formal ? { correct: "Wei Ming Tan", distractors: ["Wei Ming", "W. M."] } : { correct: "Wei Ming", distractors: ["Wei Ming Tan", "Mr Tan"] };
  return { correct: "This is the most suitable sentence for this part.", distractors: ["This is an unsuitable sentence.", "This sentence does not fit the task."] };
}

function buildManualFallbackCase(body, formal) {
  const keyInfo = Array.isArray(body.keyInfo) ? body.keyInfo.slice(0, 5) : [];
  while (keyInfo.length < 5) keyInfo.push(`Relevant detail ${keyInfo.length + 1} from the task.`);
  const scaffold = { taskText: body.taskText, task_text: body.taskText, stimulusPoints: keyInfo.map((text,i)=>({id:`s${i+1}`,text,relevant:true})), ownContentPrompt: body.ownContentPrompt || "Suggest one helpful idea for this situation.", ownContentKeywords: (body.ownContentIdeas || []).map(s=>[s]) };
  const builds = FIXED_COMPONENT_KEYS.map(key => buildOptionComponent(key, COMPONENT_LABELS(key, formal), fallbackComponentSet(key, scaffold, formal)));
  return { taskChunks: fallbackTaskChunks(body.taskText), stimulusPoints: scaffold.stimulusPoints, ownContentKeywords: scaffold.ownContentKeywords, components: builds.map(({correctId,...c})=>c), answerKey: {components:Object.fromEntries(builds.map(c=>[c.key,c.correctId])), paragraphBreaks:["purpose","keyinfo1","closing","signoff"]} };
}

function buildManualCaseFromComponents(body, formal, components) {
  const clean = components.map((c,i)=>({ key:FIXED_COMPONENT_KEYS[i], label:String(c.label || COMPONENT_LABELS(FIXED_COMPONENT_KEYS[i], formal)).slice(0,120), options:["a","b","c"].map(id=>({id,text:String(c.options?.find(o=>o.id===id)?.text || "").trim().slice(0,500)})) }));
  const answerComponents={};
  components.forEach((c,i)=>answerComponents[FIXED_COMPONENT_KEYS[i]]=["a","b","c"].includes(c.correctId)?c.correctId:"a");
  // taskChunks and distractorStimulusPoints are optional extras only the
  // JSON-import path sends (see AI_CASE_TO_JSON_PROMPT.md); the in-app
  // manual-entry form never includes them, so both fall back to the
  // pre-existing behavior when absent, keeping that form unaffected.
  const taskChunks = Array.isArray(body.taskChunks) && body.taskChunks.length
    ? body.taskChunks.map((c,i)=>({ id:`t${i+1}`, text:String(c.text||"").trim(), type:["purpose","audience","context","other"].includes(c.type)?c.type:"other" })).filter(c=>c.text)
    : fallbackTaskChunks(body.taskText);
  const relevantPoints = (body.keyInfo||[]).slice(0,5).map((text,i)=>({id:`s${i+1}`,text:String(text).trim(),relevant:true}));
  const distractorPoints = Array.isArray(body.distractorStimulusPoints)
    ? body.distractorStimulusPoints.filter((s)=>typeof s === "string" && s.trim()).slice(0,2).map((text,i)=>({id:`sx${i+1}`,text:text.trim(),relevant:false}))
    : [];
  return { taskChunks, stimulusPoints:[...relevantPoints, ...distractorPoints], ownContentKeywords:(body.ownContentIdeas||[]).map(s=>[s]), components:clean, answerKey:{components:answerComponents,paragraphBreaks:["purpose","keyinfo1","closing","signoff"]} };
}

async function aiBuildCase(env, body, formal) {
  const keyInfo = Array.isArray(body.keyInfo) ? body.keyInfo.slice(0, 5) : [];
  while (keyInfo.length < 5) keyInfo.push(`Relevant detail ${keyInfo.length + 1} from the task.`);
  const scaffold = { taskText: body.taskText, task_text: body.taskText, stimulusPoints: keyInfo.map((text, i) => ({ id:`s${i+1}`, text, relevant:true })), ownContentPrompt: body.ownContentPrompt, own_content_prompt: body.ownContentPrompt, ownContentKeywords: (body.ownContentIdeas || []).map((s) => [s]) };
  const componentResults = await Promise.all(FIXED_COMPONENT_KEYS.map((key) => aiSingleComponent(env, key, scaffold, formal)));
  const aiDetail = {};
  const componentBuilds = componentResults.map((set, i) => {
    const key = FIXED_COMPONENT_KEYS[i]; aiDetail[key] = !!set;
    return buildOptionComponent(key, COMPONENT_LABELS(key, formal), set || fallbackComponentSet(key, scaffold, formal));
  });
  const components = componentBuilds.map(({ correctId, ...c }) => c);
  const finalStimulusPoints = [...keyInfo.map((text, i) => ({ id:`s${i+1}`, text, relevant:true })), ...(await aiStimulusDistractors(env, keyInfo, body.taskText) || ["Extra detail not required in the letter", "Interesting background detail not needed here"]).map((text, i) => ({ id:`sx${i+1}`, text, relevant:false }))];
  const taskChunks = await aiTaskChunks(env, body.taskText);
  const ownContentKeywords = await aiOwnContentKeywords(env, body.ownContentPrompt, body.ownContentIdeas);
  aiDetail.taskChunks = !!taskChunks; aiDetail.stimulus = true; aiDetail.ownContentKeywords = !!ownContentKeywords;
  const answerKey = { components: Object.fromEntries(componentBuilds.map((c) => [c.key, c.correctId])), paragraphBreaks: ["purpose", "keyinfo1", "closing", "signoff"] };
  const flatFlags = FIXED_COMPONENT_KEYS.map((k) => aiDetail[k]).concat([aiDetail.taskChunks, aiDetail.stimulus, aiDetail.ownContentKeywords]);
  return { built: { taskChunks: taskChunks || fallbackTaskChunks(body.taskText), stimulusPoints: finalStimulusPoints, ownContentKeywords: ownContentKeywords || scaffold.ownContentKeywords, components, answerKey }, aiDetail, allAiUsed: flatFlags.every(Boolean), anyAiUsed: flatFlags.some(Boolean) };
}

/** Shared helper: turn {correct, distractors:[3]} into a shuffled 4-option
 * component, returning which option id ended up correct. */
function buildOptionComponent(key, label, set) {
  const distractors = (set.distractors || []).filter(Boolean).slice(0, 2);
  while (distractors.length < 2) distractors.push("This does not fit what the letter needs here.");
  const pool = [set.correct, ...distractors];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const ids = ["a", "b", "c"];
  const correctIndex = pool.indexOf(set.correct);
  return { key, label, options: pool.map((text, i) => ({ id: ids[i], text })), correctId: ids[correctIndex === -1 ? 0 : correctIndex] };
}

// ---- focused AI calls, one small JSON object each ----

async function aiSmallJson(env, prompt, maxTokens = 220) {
  try {
    const text = await callAI(env, prompt, maxTokens);
    return parseAiJson(text);
  } catch (e) {
    return null;
  }
}

async function aiTaskChunks(env, taskText) {
  const prompt = `Break this PSLE letter-writing task into short phrases and label each phrase's role.
Task: "${taskText}"
Reply with STRICT JSON only: {"chunks":[{"text":"<short phrase, a substring of the task>","type":"purpose|audience|context|other"}]}. Cover the whole task text, breaking at natural commas/clauses. Exactly one phrase should be "purpose" (what pupils must do) and one should be "audience" (who they are writing to); the rest are "context" or "other".`;
  const obj = await aiSmallJson(env, prompt, 300);
  if (!obj || !Array.isArray(obj.chunks) || !obj.chunks.length) return null;
  const valid = obj.chunks.filter((c) => c && typeof c.text === "string" && ["purpose", "audience", "context", "other"].includes(c.type));
  if (!valid.length) return null;
  return valid.map((c, i) => ({ id: `c${i + 1}`, text: c.text.trim(), type: c.type }));
}

async function aiStimulusDistractors(env, keyInfo, taskText) {
  const prompt = `PSLE letter-writing task: "${taskText}"
The correct key information pupils must include: ${JSON.stringify(keyInfo)}
Write exactly 2 short PLAUSIBLE-SOUNDING but IRRELEVANT extra details (things that fit the scene but are NOT required in the letter). Reply with STRICT JSON only: {"distractors":["...","..."]}`;
  const obj = await aiSmallJson(env, prompt, 150);
  if (!obj || !Array.isArray(obj.distractors) || !obj.distractors.length) return null;
  const valid = obj.distractors.filter((s) => typeof s === "string" && s.trim());
  return valid.length ? valid.slice(0, 2) : null;
}

async function aiOwnContentKeywords(env, ownContentPrompt, ownContentIdeas) {
  const ideas = ownContentIdeas && ownContentIdeas.length ? ownContentIdeas : null;
  const prompt = ideas
    ? `A pupil will answer this open-ended question in a PSLE letter: "${ownContentPrompt || "(suggest your own idea)"}"
Acceptable ideas from the teacher: ${JSON.stringify(ideas)}
For each idea, give 1-2 synonyms/related short phrases so a keyword-matching marker can recognise a pupil's answer even if worded differently. Reply with STRICT JSON only: {"groups":[["idea1","synonym1"],["idea2","synonym2","synonym3"]]} (one group per idea, same order).`
    : `A pupil will answer this open-ended question in a PSLE letter: "${ownContentPrompt || "(a plausible open-ended point related to the task)"}"
Suggest 2-3 plausible short answers a pupil might give, each with 1 synonym/related phrase. Reply with STRICT JSON only: {"groups":[["answer1","synonym1"],["answer2","synonym2"]]}`;
  const obj = await aiSmallJson(env, prompt, 200);
  if (!obj || !Array.isArray(obj.groups) || !obj.groups.length) return null;
  const valid = obj.groups.filter((g) => Array.isArray(g) && g.length && g.every((s) => typeof s === "string" && s.trim()));
  return valid.length ? valid : null;
}

async function aiPurposeOption(env, taskText, formal) {
  const prompt = `PSLE letter-writing task: "${taskText}"
Register: ${formal ? "FORMAL" : "INFORMAL"}.
Write ONE sentence a pupil could use as the opening "purpose" line of their letter (e.g. "I am writing to..."), matching the task and register. Then write 3 similar-length but WRONG alternative sentences a pupil might mistakenly pick instead (off-topic, wrong register, or vague). Reply with STRICT JSON only: {"correct":"...","distractors":["...","...","..."]}`;
  const obj = await aiSmallJson(env, prompt, 250);
  if (!obj || typeof obj.correct !== "string" || !obj.correct.trim() || !Array.isArray(obj.distractors) || obj.distractors.length < 3) return null;
  return { correct: obj.correct.trim(), distractors: obj.distractors.slice(0, 3).map((s) => String(s).trim()) };
}

async function aiFillerOption(env, taskText, formal) {
  const prompt = `PSLE letter-writing task: "${taskText}"
Register: ${formal ? "FORMAL" : "INFORMAL"}.
Write ONE short sentence that would naturally round off the middle of this letter (extra supporting context, before the closing), matching the register. Then write 3 similar-length but WRONG alternative sentences a pupil might mistakenly pick instead (off-topic or nonsensical). Reply with STRICT JSON only: {"correct":"...","distractors":["...","...","..."]}`;
  const obj = await aiSmallJson(env, prompt, 250);
  if (!obj || typeof obj.correct !== "string" || !obj.correct.trim() || !Array.isArray(obj.distractors) || obj.distractors.length < 3) return null;
  return { correct: obj.correct.trim(), distractors: obj.distractors.slice(0, 3).map((s) => String(s).trim()) };
}

/**
 * One batched call for ALL key-info distractor sets at once, instead of
 * one call per key-info point — cuts a case build with 4 key-info items
 * from 4 concurrent AI requests down to 1, reducing the chance of
 * hitting a free-tier provider's rate/concurrency limit. Each item is
 * still validated independently: if the model garbles or omits one
 * item's set, only that item falls back to the deterministic template
 * (see fallbackKeyInfoDistractors) — the rest of the batch is unaffected.
 */
async function aiKeyInfoDistractorsBatch(env, keyInfoList, taskText) {
  if (!keyInfoList.length) return [];
  const corrected = keyInfoList.map((k) => (k.endsWith(".") ? k : k + "."));
  const prompt = `PSLE letter-writing task: "${taskText}"
Here are the CORRECT sentences for several parts of the letter, numbered in order:
${corrected.map((c, i) => `${i + 1}. ${c}`).join("\n")}
For EACH numbered sentence, write exactly 3 similar-length but WRONG alternative sentences a pupil might mistakenly pick instead of it (irrelevant detail, wrong information, or off-topic). Reply with STRICT JSON only, one array of exactly 3 distractors per numbered item, in the same order:
{"sets":[["...","...","..."], ["...","...","..."]]}`;
  const obj = await aiSmallJson(env, prompt, 150 + keyInfoList.length * 130);
  if (!obj || !Array.isArray(obj.sets)) return keyInfoList.map(() => null);
  return keyInfoList.map((_, i) => {
    const set = obj.sets[i];
    if (!Array.isArray(set) || set.length < 3) return null;
    return set.slice(0, 3).map((s) => String(s).trim());
  });
}

// ---- deterministic fallbacks, used per-piece when a single AI call fails ----

function fallbackTaskChunks(taskText) {
  const chunks = taskText.split(/(?<=[.,])\s+/).map((text, i) => ({
    id: `c${i + 1}`, text: text.trim(), type: i === 0 ? "context" : i === 1 ? "purpose" : "other",
  }));
  const audienceIdx = Math.max(1, chunks.length - 1);
  if (chunks[audienceIdx]) chunks[audienceIdx].type = "audience";
  return chunks;
}

function fallbackSalutationSet(formal) {
  return formal
    ? { correct: "Dear Sir/Madam,", distractors: ["Hey!,", "Yo,", "Sup,"] }
    : { correct: "Hi there,", distractors: ["Dear Sir/Madam,", "To whom it may concern,", "Respected Sir,"] };
}

function fallbackSignoffSet(formal) {
  return formal
    ? { correct: "Yours faithfully,", distractors: ["Love,", "See ya,", "Bye!"] }
    : { correct: "Best,", distractors: ["Yours faithfully,", "Regards from the office,", "Sincerely yours truly,"] };
}

function fallbackPurposeSet(taskText) {
  const purposeText = taskText.split(".")[0] + ".";
  return {
    correct: `I am writing to ${purposeText.toLowerCase().replace(/^you /, "").replace(/^i /, "")}`,
    distractors: [
      "I am writing to complain about the weather.",
      "Just wanted to say hi and see what's up.",
      "I am writing regarding an unrelated matter.",
    ],
  };
}

function fallbackFillerSet(formal) {
  return {
    correct: formal
      ? "I hope this additional context is helpful for your consideration."
      : "Just thought I'd add a bit more info here!",
    distractors: [
      "This sentence has nothing to do with the letter.",
      "I am not sure why I am writing this part.",
      "Please ignore this line completely.",
    ],
  };
}

function fallbackKeyInfoDistractors() {
  return [
    "This detail is not related to the task.",
    "I forgot what I wanted to say here.",
    "Something completely different happened instead.",
  ];
}


// ---------- named exports for local testing (see tests/marking.test.mjs) ----------
// Wrangler only cares about the default export above; these extra named
// exports are inert in the Workers runtime and let a plain `node` test
// script exercise the pure scoring/assembly logic without spinning up a
// D1 database or an AI provider.
export {
  scoreOwnContentByKeyword,
  jaccardSimilarity,
  buildOptionComponent,
  assembleLetter,
  fallbackTaskChunks,
  fallbackSalutationSet,
  fallbackSignoffSet,
  fallbackPurposeSet,
  fallbackFillerSet,
  fallbackKeyInfoDistractors,
  isFreeOpenRouterModel,
  buildManualCaseFromComponents,
};
