// v2.0 — extracted from the v1.x single-file worker without behaviour changes.
import { ERROR_LABELS, normaliseFormat, publicOptionId, realisticKeyInfoDistractors } from "./marking.js";
import { DEMO_CASES } from "./demoCases.js";
import { validateCaseRow } from "./validate.js";
import { parseBuildFlags } from "./adminCases.js";
import { COMPONENT_LABELS, LETTER_COMPONENT_KEYS, buildOptionComponent } from "./adminSubmissions.js";
import { getTeacherClasses } from "./auth.js";
import { isStudentAccessEnabled } from "./casesPublic.js";
import { json } from "./common.js";

// ---------- class performance overview ----------

export async function adminListClasses(env, session) {
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
export async function checkClassAccess(env, session, className) {
  if (session.role === "admin") return null;
  const assigned = await getTeacherClasses(env, session.userId);
  if (!assigned.map((c) => c.toUpperCase()).includes(className)) {
    return json({ error: "You are not assigned to that class" }, 403);
  }
  return null;
}

export async function adminOverview(env, session, url) {
  const className = (url.searchParams.get("class") || "").trim().toUpperCase();
  if (!className) return json({ error: "Missing ?class= parameter" }, 400);
  const denied = await checkClassAccess(env, session, className);
  if (denied) return denied;

  let rows = [];
  try {
    // Every attempt (best one is picked below) — v1.14 needs each attempt's
    // stored breakdown to read the Task Fulfilment / Language & Organisation estimate.
    const { results } = await env.DB.prepare(
      `SELECT player_name, device_id, case_title, score, max_score, breakdown
       FROM leaderboard WHERE player_class = ? ORDER BY player_name, score DESC LIMIT 5000`
    ).bind(className).all();
    rows = results || [];
  } catch (e) {
    return json({ class: className, cases: [], pupils: [], note: "Leaderboard table not migrated yet — run schema.sql against your D1 database." });
  }

  // Keep each pupil's best attempt per case (two pupils sharing a first name stay separate via device_id).
  const best = new Map();
  for (const r of rows) {
    const k = r.player_name + "||" + (r.device_id || "") + "||" + r.case_title;
    const cur = best.get(k);
    if (!cur || r.score > cur.score) best.set(k, r);
  }
  const bestRows = Array.from(best.values());
  const caseTitles = Array.from(new Set(bestRows.map((r) => r.case_title)));

  // Only disambiguate a name with a device-id suffix when there's an
  // actual collision (2+ distinct device ids sharing that name) — legacy
  // rows from before device_id existed all share an empty string.
  const devicesByName = new Map();
  for (const r of bestRows) {
    if (!devicesByName.has(r.player_name)) devicesByName.set(r.player_name, new Set());
    devicesByName.get(r.player_name).add(r.device_id || "");
  }
  const parse = (x) => { try { return x ? JSON.parse(x) : {}; } catch (e) { return {}; } };
  const byPupil = new Map();
  for (const r of bestRows) {
    const pupilKey = r.player_name + "||" + (r.device_id || "");
    if (!byPupil.has(pupilKey)) {
      const hasCollision = (devicesByName.get(r.player_name)?.size || 1) > 1;
      const displayName = hasCollision && r.device_id ? `${r.player_name} (#${r.device_id.slice(0, 4)})` : r.player_name;
      byPupil.set(pupilKey, { name: displayName, scores: {} });
    }
    const moe = parse(r.breakdown)._moe || null;
    byPupil.get(pupilKey).scores[r.case_title] = {
      score: r.score, max: r.max_score,
      tf: moe ? moe.taskFulfilment : null, tfMax: moe ? 6 : null,
      lo: moe ? moe.languageOrg : null, loMax: moe ? 8 : null,
    };
  }
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null);
  const pupils = Array.from(byPupil.values()).map((p) => {
    const cells = caseTitles.filter((t) => p.scores[t]).map((t) => p.scores[t]);
    p.average = avg(cells.map((c) => (c.score / c.max) * 100));
    p.averageTf = avg(cells.filter((c) => c.tf !== null).map((c) => (c.tf / c.tfMax) * 100));
    p.averageLo = avg(cells.filter((c) => c.lo !== null).map((c) => (c.lo / c.loMax) * 100));
    return p;
  });
  pupils.sort((a, b) => (b.average ?? -1) - (a.average ?? -1));

  return json({ class: className, cases: caseTitles, pupils });
}

/** v1.14: which letter mistakes show up most across a class's submissions. */
export async function adminLetterErrors(env, session, url) {
  const className = (url.searchParams.get("class") || "").trim().toUpperCase();
  if (!className) return json({ error: "Missing ?class= parameter" }, 400);
  const denied = await checkClassAccess(env, session, className);
  if (denied) return denied;
  let rows = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT case_title, error_flags FROM submissions WHERE player_class = ? AND error_flags IS NOT NULL ORDER BY created_at DESC LIMIT 500"
    ).bind(className).all();
    rows = results || [];
  } catch (e) {
    return json({ class: className, totalSubmissions: 0, errors: [], note: "Submissions table not migrated yet." });
  }
  const counts = {};
  let n = 0;
  for (const r of rows) {
    let flags = [];
    try { flags = JSON.parse(r.error_flags || "[]"); } catch (e) { continue; }
    n++;
    for (const f of flags) counts[f] = (counts[f] || 0) + 1;
  }
  const errors = Object.entries(counts).map(([code, count]) => ({
    code, label: ERROR_LABELS[code] || code, count, pct: n ? Math.round((count / n) * 100) : 0,
  })).sort((a, b) => b.count - a.count);
  return json({ class: className, totalSubmissions: n, errors });
}

/**
 * Common-mistakes view: for a class, find MCQ components where a
 * particular WRONG option gets picked disproportionately often — a
 * signal of a class-wide misconception ("half the class thinks this is
 * a formal sign-off") that a plain average score can't show.
 */
export async function adminMisconceptions(env, session, url) {
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
export function toPublicCase(c) {
  return {
    id: c.id,
    title: c.title,
    imageData: c.image_data ?? c.imageData,
    taskText: c.task_text ?? c.taskText,
    taskChunks: (typeof c.task_chunks === "string" ? JSON.parse(c.task_chunks) : c.taskChunks)
      .map(({ id, text }) => ({ id, text })), // strip `type`
    formal: !!(c.formal ?? c.formal === 1),
    format: normaliseFormat(c),
    stimulusPoints: (typeof c.stimulus_points === "string" ? JSON.parse(c.stimulus_points) : c.stimulusPoints)
      .map(({ id, text }) => ({ id, text })), // strip `relevant`
    ownContentPrompt: c.own_content_prompt ?? c.ownContentPrompt,
    // v1.12: teacher-supplied "required content points" (text and/or picture)
    // shown in Step 2, and an optional Step 3 hint. Only sent when set so the
    // pupil UI can simply test for truthiness (no hint => no Hint button).
    requiredText: (c.required_text ?? c.requiredText) || "",
    requiredImageData: (c.required_image ?? c.requiredImageData) || null,
    hunchHint: ((c.hunch_hint ?? c.hunchHint) || "").trim(),
    components: (typeof c.components === "string" ? JSON.parse(c.components) : c.components)
      .map((comp) => ({
        key: comp.key,
        label: comp.label,
        options: comp.options.map((o) => ({ id: publicOptionId(c.id, comp.key, o.id), text: o.text })), // strip correctness + opaque ids
      })),
  };
}

export function fullCaseFromRow(row) {
  const full = {
    ...row,
    taskChunks: JSON.parse(row.task_chunks),
    stimulusPoints: JSON.parse(row.stimulus_points),
    ownContentKeywords: JSON.parse(row.own_content_keywords || "[]"),
    components: JSON.parse(row.components),
    answerKey: JSON.parse(row.answer_key),
    imageData: row.image_data || null,
    requiredText: row.required_text || "",
    requiredImageData: row.required_image || null,
    hunchHint: row.hunch_hint || "",
    buildFlags: parseBuildFlags(row.build_flags),
  };
  return ensureV16Components(full);
}

export function ensureV16Components(full) {
  full.format = normaliseFormat(full);
  // Articles never had the legacy 3-9 part shapes, so there is nothing to upgrade.
  if (full.format === "article") return full;
  if (Array.isArray(full.components) && JSON.stringify(full.components.map(c => c.key)) === JSON.stringify(LETTER_COMPONENT_KEYS)) return full;
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
    keyinfo1: existingSet("keyinfo1", pts[0] || "The first important detail is included in the notice.", ...realisticKeyInfoDistractors(pts[0] || "The first important detail is included in the notice.")),
    keyinfo2: existingSet("keyinfo2", pts[1] || "The second important detail is included in the notice.", ...realisticKeyInfoDistractors(pts[1] || "The second important detail is included in the notice.")),
    keyinfo3: existingSet("keyinfo3", pts[2] || "The third important detail is included in the notice.", ...realisticKeyInfoDistractors(pts[2] || "The third important detail is included in the notice.")),
    keyinfo4: existingSet("keyinfo4", pts[3] || "The fourth important detail is included in the notice.", ...realisticKeyInfoDistractors(pts[3] || "The fourth important detail is included in the notice.")),
    keyinfo5: existingSet("keyinfo5", pts[4] || "The fifth important detail is included in the notice.", ...realisticKeyInfoDistractors(pts[4] || "The fifth important detail is included in the notice.")),
    ownIdea: { correct: full.ownContentKeywords?.[0]?.[0] || "suggest a helpful idea", distractors: [full.ownContentKeywords?.[1]?.[0] || "offer another practical way to help", full.ownContentKeywords?.[2]?.[0] || "contribute in another suitable way"] },
    closing: existingSet("closing", formal ? "Thank you for considering my suggestion." : "Hope to hear from you soon!", "This is the end of an unrelated topic.", "I am not sure what else to say."),
    signoff: existingSet("signoff", formal ? "Yours sincerely," : "Best,", "Yours faithfully,", "Love and hugs forever,"),
    name: { correct: formal ? "Wei Ming Tan" : "Wei Ming", distractors: [formal ? "Wei Ming" : "Wei Ming Tan", "Mr Tan"] },
  };
  const builds = LETTER_COMPONENT_KEYS.map(key => buildOptionComponent(key, COMPONENT_LABELS(key, formal), sets[key]));
  full.components = builds.map(({correctId, ...c}) => c);
  full.answerKey = { components: Object.fromEntries(builds.map(c => [c.key, c.correctId])), paragraphBreaks: full.answerKey?.paragraphBreaks || ["greeting", "keyinfo1", "closing", "signoff"] };
  return full;
}

export async function findFullCase(env, id) {
  const demo = DEMO_CASES.find((c) => c.id === id);
  if (demo) return demo;
  const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(id).first();
  if (!row) return null;
  return fullCaseFromRow(row);
}

/** Pupil-facing lookup: only demo cases or PUBLISHED, structurally valid DB cases. */
export async function findPlayableCase(env, id) {
  const demo = DEMO_CASES.find((c) => c.id === id);
  if (demo) return demo;
  const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(id).first();
  if (!row || row.status !== "published" || !validateCaseRow(row).ok) return null;
  try { return fullCaseFromRow(row); } catch (e) { return null; }
}

/** GET /api/cases/:id/image — serves a published case picture as a cacheable image (keeps the menu payload small). */
export async function getCaseImage(env, id) {
  if (!(await isStudentAccessEnabled(env))) return json({ error: "Student access is currently disabled." }, 403);
  const row = await env.DB.prepare("SELECT image_data, status FROM cases WHERE id = ?").bind(id).first();
  const m = row && row.status === "published" && /^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(row.image_data || "");
  if (!m) return json({ error: "Not found" }, 404);
  const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { "content-type": m[1].toLowerCase(), "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
}

