/**
 * Boss! There's a situation! — Worker
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
 *   GET    /api/admin/cases         -> all cases incl. drafts + answer keys
 *   POST   /api/admin/cases         -> create a case from teacher input, AI-assisted
 *   DELETE /api/admin/cases/:id     -> remove a teacher-uploaded case
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
 *
 * AI marking runs through a provider fallback chain (see callAI() below):
 * OpenRouter -> Groq -> Gemini -> Cloudflare Workers AI. Every AI call in
 * this file goes through that one function, so the whole game degrades
 * gracefully to deterministic scoring if every provider is unavailable.
 */

import { DEMO_CASES } from "./demoCases.js";

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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
      if (path === "/api/leaderboard" && request.method === "GET") {
        return await getLeaderboard(env, url);
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
        return await requireAuth(env, request, () => adminCreateCase(env, request));
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

async function adminLogin(env, request) {
  const body = await request.json().catch(() => ({}));
  const username = (body.username || "").toString().trim();
  const password = (body.password || "").toString();
  if (!username || !password) return json({ error: "Username and password required" }, 400);

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
      return json({ error: "Invalid credentials" }, 401);
    }
  } else {
    const ok = await verifyPassword(password, userRow.password_salt, userRow.password_hash);
    if (!ok) return json({ error: "Invalid credentials" }, 401);
  }

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

async function adminOverview(env, session, url) {
  const className = (url.searchParams.get("class") || "").trim().toUpperCase();
  if (!className) return json({ error: "Missing ?class= parameter" }, 400);

  if (session.role !== "admin") {
    const assigned = await getTeacherClasses(env, session.userId);
    if (!assigned.map((c) => c.toUpperCase()).includes(className)) {
      return json({ error: "You are not assigned to that class" }, 403);
    }
  }

  let rows = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT player_name, case_title, MAX(score) as best, MAX(max_score) as mx
       FROM leaderboard WHERE player_class = ?
       GROUP BY player_name, case_title
       ORDER BY player_name`
    ).bind(className).all();
    rows = results || [];
  } catch (e) {
    return json({ class: className, cases: [], pupils: [], note: "Leaderboard table not migrated yet — run schema.sql against your D1 database." });
  }

  const caseTitles = Array.from(new Set(rows.map((r) => r.case_title)));
  const byPupil = new Map();
  for (const r of rows) {
    if (!byPupil.has(r.player_name)) byPupil.set(r.player_name, { name: r.player_name, scores: {} });
    byPupil.get(r.player_name).scores[r.case_title] = { score: r.best, max: r.mx };
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
  return {
    ...row,
    taskChunks: JSON.parse(row.task_chunks),
    stimulusPoints: JSON.parse(row.stimulus_points),
    ownContentKeywords: JSON.parse(row.own_content_keywords || "[]"),
    components: JSON.parse(row.components),
    answerKey: JSON.parse(row.answer_key),
  };
}

async function findFullCase(env, id) {
  const demo = DEMO_CASES.find((c) => c.id === id);
  if (demo) return demo;
  const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(id).first();
  if (!row) return null;
  return fullCaseFromRow(row);
}

// ---------- case listing / retrieval ----------

async function listCases(env) {
  const demoList = DEMO_CASES.map((c) => ({
    id: c.id, title: c.title, formal: c.formal, imageData: c.imageData, builtin: true,
  }));
  let dbList = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, title, formal, image_data FROM cases WHERE status = 'published' ORDER BY created_at DESC"
    ).all();
    dbList = (results || []).map((r) => ({
      id: r.id, title: r.title, formal: !!r.formal, imageData: r.image_data, builtin: false,
    }));
  } catch (e) { /* DB might not be migrated yet — demo cases still work */ }
  return json({ cases: [...demoList, ...dbList] });
}

async function getCase(env, id) {
  const full = await findFullCase(env, id);
  if (!full) return json({ error: "Case not found" }, 404);
  return json({ case: toPublicCase(full) });
}

// ---------- scoring ----------

async function submitCase(env, request, id) {
  const full = await findFullCase(env, id);
  if (!full) return json({ error: "Case not found" }, 404);
  const body = await request.json();
  const name = (body.name || "Anonymous Detective").toString().slice(0, 40);
  const playerClass = (body.playerClass || "").toString().slice(0, 20).trim().toUpperCase();

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
  const componentChoices = body.componentChoices || {}; // { key: optionId }
  const compKeys = Object.keys(full.answerKey.components || {});
  let compCorrect = 0;
  for (const key of compKeys) {
    if (componentChoices[key] === full.answerKey.components[key]) compCorrect++;
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

  // 5) Own content plausibility — keyword match, AI-assisted if available
  const ownContent = (body.ownContent || "").toString().slice(0, 500);
  let ownScore = scoreOwnContentByKeyword(ownContent, full.ownContentKeywords, w.ownContent);
  let ownAiNote = null;
  if (ownContent.trim().length > 0) {
    try {
      const aiJudged = await aiJudgeOwnContent(env, full, ownContent, w.ownContent);
      if (aiJudged) { ownScore = aiJudged.score; ownAiNote = aiJudged.note; }
    } catch (e) { /* fall back silently to keyword score */ }
  }
  breakdown.ownContent = { score: ownScore, max: w.ownContent, aiNote: ownAiNote };

  // 6) AI holistic read of the assembled letter vs model answer
  const assembledLetter = assembleLetter(full, componentChoices, paragraphBreaks);
  let holisticScore = Math.round(jaccardSimilarity(assembledLetter, full.model_letter) * w.overallQuality);
  let holisticNote = null;
  try {
    const aiHolistic = await aiHolisticMark(env, full, assembledLetter, w.overallQuality);
    if (aiHolistic) { holisticScore = aiHolistic.score; holisticNote = aiHolistic.note; }
  } catch (e) { /* fall back silently */ }
  breakdown.overallQuality = { score: holisticScore, max: w.overallQuality, aiNote: holisticNote };

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
      "INSERT INTO leaderboard (player_name, player_class, case_id, case_title, score, max_score, breakdown) VALUES (?,?,?,?,?,?,?)"
    ).bind(name, playerClass, full.id, full.title, total, total_max, JSON.stringify(breakdown)).run();
  } catch (e) { /* leaderboard table may not be migrated; still return the score */ }

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

function assembleLetter(full, componentChoices, paragraphBreaksSet) {
  let out = "";
  for (const comp of full.components) {
    const chosenId = componentChoices[comp.key];
    const opt = comp.options.find((o) => o.id === chosenId);
    const text = opt ? opt.text : "";
    if (!text) continue;
    if (paragraphBreaksSet.has(comp.key) && out.length) out += "\n\n";
    else if (out.length) out += " ";
    out += text;
  }
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

async function callOpenRouter(env, prompt, maxTokens) {
  const key = env.OPENROUTER_API_KEY;
  if (!key) return null;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://boss-theres-a-situation.workers.dev",
      "X-Title": "Boss! There's a situation!",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct",
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
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.GROQ_MODEL || "llama-3.1-8b-instant",
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
  const model = env.GEMINI_MODEL || "gemini-1.5-flash";
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

/** Try OpenRouter, then Groq, then Gemini, then Workers AI. Returns the
 * raw text response from whichever provider answers first, or null. */
async function callAI(env, prompt, maxTokens = 500) {
  const providers = [callOpenRouter, callGroq, callGemini, callWorkersAIText];
  for (const provider of providers) {
    try {
      const text = await provider(env, prompt, maxTokens);
      if (text) return text;
    } catch (e) { /* this provider failed or errored — try the next one */ }
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

// ---------- admin: case management ----------

async function adminListCases(env) {
  const { results } = await env.DB.prepare("SELECT * FROM cases ORDER BY created_at DESC").all();
  return json({ cases: (results || []).map(fullCaseFromRow) });
}

async function adminDeleteCase(env, id) {
  await env.DB.prepare("DELETE FROM cases WHERE id = ?").bind(id).run();
  return json({ ok: true });
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
 */
async function adminCreateCase(env, request) {
  const body = await request.json();
  const required = ["title", "taskText", "keyInfo", "modelLetter"];
  for (const f of required) {
    if (!body[f] || (Array.isArray(body[f]) && body[f].length === 0)) {
      return json({ error: `Missing field: ${f}` }, 400);
    }
  }
  const formal = !!body.formal;
  const id = newId("case");

  let built = await aiBuildCase(env, body, formal).catch(() => null);
  const aiUsed = !!built;
  if (!built) built = ruleBasedBuildCase(body, formal);

  await env.DB.prepare(
    `INSERT INTO cases (id, title, image_data, task_text, task_chunks, formal,
      stimulus_points, own_content_prompt, own_content_keywords, components,
      answer_key, model_letter, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, body.title, body.imageData || null, body.taskText,
    JSON.stringify(built.taskChunks), formal ? 1 : 0,
    JSON.stringify(built.stimulusPoints), body.ownContentPrompt || "",
    JSON.stringify(built.ownContentKeywords), JSON.stringify(built.components),
    JSON.stringify(built.answerKey), body.modelLetter, "published"
  ).run();

  return json({ id, built, aiUsed });
}

/** Ask the AI provider chain to build the full playable structure in one shot. */
async function aiBuildCase(env, body, formal) {
  const prompt = `You are building a PSLE (Singapore Primary 6) English situational writing practice game.
Register: ${formal ? "FORMAL" : "INFORMAL"}.
Task given to pupils: "${body.taskText}"
Key information points the teacher wants covered: ${JSON.stringify(body.keyInfo)}
Own-content question (pupil must supply an idea not given in the stimulus): "${body.ownContentPrompt || "(none given — infer one plausible open-ended point from the task)"}"
Acceptable own-content ideas from teacher (may be empty): ${JSON.stringify(body.ownContentIdeas || [])}
Model/reference letter written by the teacher:
"""${body.modelLetter}"""

Produce STRICT JSON only, matching exactly this shape:
{
  "taskChunks": [{"id":"c1","text":"<substring of the task text>","type":"purpose|audience|context|other"}, ... covering the WHOLE task text broken into short phrases],
  "stimulusPoints": [{"id":"s1","text":"<short key info phrase>","relevant":true|false}, ... include all teacher key info points as relevant:true PLUS 2 plausible but irrelevant distractor details with relevant:false],
  "ownContentKeywords": [["keyword1","synonym1"], ["keyword2","synonym2"]],
  "components": [
    {"key":"salutation","label":"Salutation","options":[{"id":"a","text":"..."},{"id":"b","text":"..."},{"id":"c","text":"..."},{"id":"d","text":"..."}]},
    {"key":"greeting","label":"Opening line","options":[...4 options...]},
    {"key":"purpose","label":"Purpose","options":[...4 options...]},
    {"key":"keyinfo1","label":"Key information 1","options":[...4 options...]},
    {"key":"keyinfo2","label":"Key information 2","options":[...4 options...]},
    {"key":"filler","label":"Additional context","options":[...4 options...]},
    {"key":"signoff","label":"Sign-off","options":[...4 options...]}
  ],
  "answerKey": {
    "components": {"salutation":"a","greeting":"a","purpose":"a","keyinfo1":"a","keyinfo2":"a","filler":"a","signoff":"a"},
    "paragraphBreaks": ["purpose","keyinfo1","filler"]
  }
}
Rules: exactly one option per component must be the best/correct one matching the model letter's register (${formal ? "formal" : "informal"}) and content; the other 3 must be plausible-but-wrong (wrong register, missing info, or off-topic). Every option is a full sentence pupils would paste into their letter. Only output the JSON, nothing else.`;

  const text = await callAI(env, prompt, 1800);
  const obj = parseAiJson(text);
  if (!obj || !obj.components || !obj.answerKey) return null;
  return obj;
}

/** No-AI fallback: simple template so the case is still playable. */
function ruleBasedBuildCase(body, formal) {
  const chunks = body.taskText.split(/(?<=[.,])\s+/).map((text, i) => ({
    id: `c${i + 1}`, text: text.trim(), type: i === 0 ? "context" : i === 1 ? "purpose" : "other",
  }));
  const audienceIdx = Math.max(1, chunks.length - 1);
  if (chunks[audienceIdx]) chunks[audienceIdx].type = "audience";

  const stimulusPoints = body.keyInfo.map((text, i) => ({ id: `s${i + 1}`, text, relevant: true }));
  stimulusPoints.push({ id: "sx1", text: "Extra flavour detail not required in your letter", relevant: false });

  const sal = formal ? "Dear Sir/Madam," : "Hi there,";
  const salOpts = [
    { id: "a", text: sal },
    { id: "b", text: formal ? "Hey!," : "Dear Sir/Madam," },
    { id: "c", text: "To whom it may concern," },
    { id: "d", text: "Yo," },
  ];
  const purposeText = body.taskText.split(".")[0] + ".";
  const purposeOpts = [
    { id: "a", text: `I am writing to ${purposeText.toLowerCase().replace(/^you /, "").replace(/^i /, "")}` },
    { id: "b", text: "I am writing to complain about the weather." },
    { id: "c", text: "Just wanted to say hi and see what's up." },
    { id: "d", text: "I am writing regarding an unrelated matter." },
  ];
  const keyinfoComponents = body.keyInfo.slice(0, 3).map((k, i) => ({
    key: `keyinfo${i + 1}`,
    label: `Key information ${i + 1}`,
    options: [
      { id: "a", text: k.endsWith(".") ? k : k + "." },
      { id: "b", text: "This detail is not related to the task." },
      { id: "c", text: "I forgot what I wanted to say here." },
      { id: "d", text: "Something completely different happened instead." },
    ],
  }));
  const signOpts = formal
    ? [{ id: "a", text: "Yours faithfully," }, { id: "b", text: "Love," }, { id: "c", text: "See ya," }, { id: "d", text: "Bye!" }]
    : [{ id: "a", text: "Best," }, { id: "b", text: "Yours faithfully," }, { id: "c", text: "Regards from the office," }, { id: "d", text: "Sincerely yours truly," }];

  const components = [
    { key: "salutation", label: "Salutation", options: salOpts },
    { key: "purpose", label: "Purpose", options: purposeOpts },
    ...keyinfoComponents,
    { key: "signoff", label: "Sign-off", options: signOpts },
  ];
  const answerKey = {
    components: Object.fromEntries(components.map((c) => [c.key, "a"])),
    paragraphBreaks: ["purpose", "signoff"],
  };
  return {
    taskChunks: chunks,
    stimulusPoints,
    ownContentKeywords: (body.ownContentIdeas || []).map((s) => [s]),
    components,
    answerKey,
  };
}
