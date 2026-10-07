// v2.0 — extracted from the v1.x single-file worker without behaviour changes.
import { ERROR_LABELS, checkFix, computeRank, normaliseFormat, unlockedLevel } from "./marking.js";
import { DEMO_CASES } from "./demoCases.js";
import { getRubric } from "./auth.js";
import { isAppSettingEnabled, isBlockedTutorialCase, isStudentAccessEnabled, isTutorialCasesEnabled, setAppSettingEnabled } from "./casesPublic.js";
import { json } from "./common.js";
import { APP_VERSION, REVIEW_COOLDOWN_HOURS } from "./config.js";
import { findPlayableCase } from "./overview.js";

// ---------- leaderboard ----------

export async function getLeaderboard(env, url) {
  const limit = Math.min(50, Number(url.searchParams.get("limit")) || 20);
  const className = (url.searchParams.get("class") || "").trim().toUpperCase().slice(0, 20);
  // v1.14: pupils can hide their name from the Wall (hide_on_board), and the
  // Wall defaults to the pupil's own class so it motivates rather than discourages.
  const cols = "player_name, player_class, case_title, score, max_score, created_at";
  const tiers = [
    { sql: `SELECT ${cols} FROM leaderboard WHERE hide_on_board = 0 ${className ? "AND player_class = ?" : ""} ORDER BY score DESC, created_at ASC LIMIT ?`, binds: className ? [className, limit] : [limit] },
    { sql: `SELECT player_name, case_title, score, created_at FROM leaderboard ORDER BY score DESC, created_at ASC LIMIT ?`, binds: [limit] },
  ];
  for (const t of tiers) {
    try {
      const { results } = await env.DB.prepare(t.sql).bind(...t.binds).all();
      return json({ leaderboard: results || [], class: className || null });
    } catch (e) { /* try the older query */ }
  }
  return json({ leaderboard: [], note: "Leaderboard table not migrated yet — run schema.sql against your D1 database." });
}

/**
 * Spaced review: a case is "due" for a pupil if their most recent attempt
 * scored below the CURRENT mastery threshold and enough time has passed
 * since that attempt (REVIEW_COOLDOWN_HOURS) — simple time-boxed spacing
 * rather than a full SM-2 scheduler, but enough to stop the game being
 * purely "pick whatever looks fun" and nudge pupils back to what they
 * haven't mastered yet, after a delay rather than in an immediate loop.
 */
export async function getPracticeDue(env, url) {
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
export async function getMyScores(env, url) {
  const name = (url.searchParams.get("name") || "").toString().trim().slice(0, 40);
  const playerClass = (url.searchParams.get("playerClass") || "").toString().trim().slice(0, 20).toUpperCase();
  const deviceId = (url.searchParams.get("deviceId") || "").toString().trim().slice(0, 40);
  const allLevels = await isAppSettingEnabled(env, "all_levels_unlocked", false);
  const emptyProfile = { rank: computeRank(0), masteredCount: 0, attempts: 0, bests: {}, unlockedLevel: allLevels ? 3 : 1, allLevelsUnlocked: allLevels, weaknesses: [] };
  if (!name) return json({ scores: [], profile: emptyProfile });
  const rubric = await getRubric(env);
  const where = deviceId ? "l.player_name = ? AND l.player_class = ? AND l.device_id = ?" : "l.player_name = ? AND l.player_class = ?";
  const binds = deviceId ? [name, playerClass, deviceId] : [name, playerClass];
  const tiers = [
    `SELECT l.case_id, l.case_title, l.score, l.max_score, l.created_at, l.breakdown, s.needs_review, s.override_comment, s.level, s.error_flags
       FROM leaderboard l LEFT JOIN submissions s ON s.leaderboard_id = l.id WHERE ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT 100`,
    `SELECT l.case_id, l.case_title, l.score, l.max_score, l.created_at, l.breakdown, s.needs_review, s.override_comment
       FROM leaderboard l LEFT JOIN submissions s ON s.leaderboard_id = l.id WHERE ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT 100`,
    `SELECT l.case_id, l.case_title, l.score, l.max_score, l.created_at, l.breakdown FROM leaderboard l WHERE ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT 100`,
  ];
  let rows = null;
  for (const sql of tiers) {
    try { const { results } = await env.DB.prepare(sql).bind(...binds).all(); rows = results || []; break; } catch (e) { /* older schema */ }
  }
  if (!rows) return json({ scores: [], profile: emptyProfile });

  const parse = (x, d) => { try { return x ? JSON.parse(x) : d; } catch (e) { return d; } };
  const thr = rubric.masteryThreshold;
  const asc = rows.slice().reverse();
  const runningBest = {}, bests = {}, masteredSets = { 1: new Set(), 2: new Set(), 3: new Set() }, masteredAny = new Set();
  for (const r of asc) {
    const prev = runningBest[r.case_id];
    r._delta = prev === undefined ? null : r.score - prev.last;
    r._pb = prev !== undefined && r.score > prev.best;
    runningBest[r.case_id] = { best: Math.max(prev ? prev.best : -1, r.score), last: r.score };
    const lvl = [1, 2, 3].includes(Number(r.level)) ? Number(r.level) : 1;
    r._level = lvl;
    if (!bests[r.case_id] || r.score > bests[r.case_id].best) bests[r.case_id] = { best: r.score, max: r.max_score, mastered: false };
    if (r.score >= thr) { masteredSets[lvl].add(r.case_id); masteredAny.add(r.case_id); }
  }
  for (const id of masteredAny) if (bests[id]) bests[id].mastered = true;
  const counts = { 1: masteredSets[1].size, 2: masteredSets[2].size, 3: masteredSets[3].size };
  const flagCounts = {};
  for (const r of rows.slice(0, 10)) for (const f of parse(r.error_flags, [])) flagCounts[f] = (flagCounts[f] || 0) + 1;
  const weaknesses = Object.entries(flagCounts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([code, count]) => ({ code, label: ERROR_LABELS[code] || code, count }));
  const profile = {
    rank: computeRank(masteredAny.size), masteredCount: masteredAny.size, attempts: rows.length, bests,
    unlockedLevel: allLevels ? 3 : unlockedLevel(counts), allLevelsUnlocked: allLevels, weaknesses,
  };
  const scores = rows.slice(0, 30).map((r) => ({
    case_id: r.case_id, case_title: r.case_title, score: r.score, max_score: r.max_score, created_at: r.created_at,
    pendingReview: !!r.needs_review, teacherComment: r.override_comment || "",
    level: r._level, moe: (parse(r.breakdown, {}) || {})._moe || null, delta: r._delta, personalBest: r._pb,
  }));
  return json({ scores, profile });
}

export async function getConfig(env) {
  return json({ version: APP_VERSION, allLevelsUnlocked: await isAppSettingEnabled(env, "all_levels_unlocked", false) });
}

export async function getLevelsAccessSetting(env) { return json({ enabled: await isAppSettingEnabled(env, "all_levels_unlocked", false) }); }
export async function setLevelsAccessSetting(env, request, session) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
  try {
    await setAppSettingEnabled(env, "all_levels_unlocked", body.enabled);
    return json({ enabled: body.enabled, changedBy: session.username });
  } catch (e) { return json({ error: "Could not save the setting. Run schema.sql against the D1 database." }, 500); }
}

/** Pupil-facing "fix this one thing" check — deterministic, no AI, no DB write. */
export async function fixCheck(env, request, id) {
  if (!(await isStudentAccessEnabled(env))) return json({ error: "Student access is currently disabled." }, 403);
  if (await isBlockedTutorialCase(env, id)) return json({ error: "Tutorial cases are currently disabled." }, 403);
  const full = await findPlayableCase(env, id);
  if (!full) return json({ error: "Case not found" }, 404);
  const body = await request.json().catch(() => ({}));
  const task = body.task && typeof body.task === "object" ? { kind: String(body.task.kind || ""), pointId: String(body.task.pointId || "") } : null;
  if (!task || !["point", "pair", "clue", "purpose", "cta", "title", "byline"].includes(task.kind)) return json({ error: "Unknown fix type." }, 400);
  const text = String(body.text || "").slice(0, 600);
  const relevantPoints = full.stimulusPoints.filter((p) => p.relevant).map((p) => ({ id: p.id, text: p.text }));
  return json(checkFix(task, text, { relevantPoints, format: normaliseFormat(full) }));
}

