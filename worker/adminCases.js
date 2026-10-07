// v2.0 — extracted from the v1.x single-file worker without behaviour changes.
import { normaliseFormat } from "./marking.js";
import { validateCaseRow } from "./validate.js";
import { ARTICLE_COMPONENT_KEYS, ARTICLE_ONLY_KEYS, COMPONENT_LABELS, LETTER_COMPONENT_KEYS, aiBuildCase, buildManualCaseFromComponents, buildManualFallbackCase, componentKeysFor, formatFromBody } from "./adminSubmissions.js";
import { json, newId } from "./common.js";
import { MAX_HINT_LEN, MAX_REQUIRED_TEXT_LEN, MAX_STIMULUS_TILES, MAX_TASK_CHUNKS, TASK_CHUNK_TYPES } from "./config.js";
import { fullCaseFromRow } from "./overview.js";

// ---------- admin: case management ----------

export async function adminListCases(env) {
  const { results } = await env.DB.prepare("SELECT * FROM cases ORDER BY created_at DESC").all();
  const out = (results || []).map((row) => {
    const validation = validateCaseRow(row);
    try { return { ...fullCaseFromRow(row), validation }; }
    catch (e) {
      // Broken JSON from a manual SQL import: still list it so the teacher can see the checklist and delete/fix it.
      return { id: row.id, title: row.title || row.id, status: row.status, format: normaliseFormat(row), imageData: null, broken: true, buildFlags: { failedParts: [] }, validation };
    }
  });
  return json({ cases: out });
}

export async function adminDeleteCase(env, id) {
  await env.DB.prepare("DELETE FROM cases WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

/** Review gate: a freshly AI-built case starts as a draft (see
 * adminCreateCase) and is invisible to pupils until a teacher/admin
 * explicitly publishes it here. Records who approved it and when,
 * separately from who originally built it (created_by), since a
 * different teacher may review someone else's draft. */
export async function adminPublishCase(env, id, session, force = false) {
  const row = await env.DB.prepare("SELECT id, status, build_flags FROM cases WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Case not found" }, 404);
  if (row.status === "published") return json({ ok: true, alreadyPublished: true });
  // v1.16: structural checks are not bypassable with ?force=1.
  const full = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(id).first();
  const check = validateCaseRow(full);
  if (!check.ok) return json({ error: "This case has structural problems and cannot be published: " + check.errors.slice(0, 3).join(" "), problems: check.errors }, 422);
  // v1.12: a case whose AI build failed on some parts still contains template
  // placeholder text there. Refuse to publish it unless the teacher has fixed
  // those parts — or explicitly chosen to publish anyway (?force=1).
  const unresolved = parseBuildFlags(row.build_flags).failedParts;
  if (unresolved.length && !force) {
    return json({
      error: "AI could not build some parts of this case, so they still contain template text. Fix them in the case editor, or publish anyway.",
      needsForce: true, failedParts: unresolved, failedLabels: unresolved.map(partLabel),
    }, 409);
  }
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
export function parseBuildFlags(raw) {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    const failedParts = Array.isArray(obj?.failedParts) ? obj.failedParts.filter((x) => typeof x === "string") : [];
    return { failedParts, at: obj?.at || null };
  } catch (e) { return { failedParts: [], at: null }; }
}

export function partLabel(key) {
  if (key === "taskChunks") return "Step 1 clue tags";
  if (key === "stimulus") return "Step 2 distractor tiles";
  if (LETTER_COMPONENT_KEYS.includes(key) || ARTICLE_COMPONENT_KEYS.includes(key)) return "Step 4: " + COMPONENT_LABELS(key, ARTICLE_ONLY_KEYS.has(key) ? "article" : true).replace(" (formal)", "").replace(" (informal)", "");
  return key;
}

/** Remove resolved parts from a case's stored AI-failure flags. */
export function buildFlagsJsonWithout(raw, resolvedParts) {
  const cur = parseBuildFlags(raw);
  const left = cur.failedParts.filter((k) => !resolvedParts.includes(k));
  return left.length ? JSON.stringify({ failedParts: left, at: cur.at }) : null;
}

/** Returns an error string, or null if the data URL is an acceptable picture. */
export function validateImageData(imageData) {
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(imageData)) return "Unsupported image format. Use PNG, JPEG, WebP or GIF.";
  if (imageData.length > 760000) return "Image is too large. Keep it below about 500 KB before upload.";
  return null;
}

/** Step 1 editor payload -> clean chunk list (ids reassigned c1..cn). */
export function normaliseTaskChunks(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) return { error: "Add at least one task chunk." };
  if (chunks.length > MAX_TASK_CHUNKS) return { error: `A case can have at most ${MAX_TASK_CHUNKS} task chunks.` };
  const out = [];
  for (const c of chunks) {
    const text = String(c?.text || "").trim().slice(0, 300);
    if (!text) continue; // blank rows are simply dropped
    const type = TASK_CHUNK_TYPES.includes(c?.type) ? c.type : null;
    if (!type) return { error: `Chunk "${text.slice(0, 30)}…" needs a type (Purpose, Audience, Context, Optional or Not needed).` };
    out.push({ id: `c${out.length + 1}`, text, type });
  }
  if (!out.length) return { error: "Add at least one task chunk." };
  if (!out.some((c) => c.type === "purpose")) return { error: "Mark at least one chunk as the Purpose." };
  if (!out.some((c) => c.type === "audience")) return { error: "Mark at least one chunk as the Audience." };
  return { chunks: out };
}

/** Step 2 editor payload ([{text, correct}], max 12) -> stimulusPoints. */
export function buildStimulusPointsFromTiles(tiles) {
  if (!Array.isArray(tiles)) return { error: "Tiles must be a list." };
  const clean = tiles
    .map((t) => ({ text: String(t?.text || "").trim().slice(0, 200), correct: !!t?.correct }))
    .filter((t) => t.text);
  if (!clean.length) return { error: "Add at least one option tile." };
  if (clean.length > MAX_STIMULUS_TILES) return { error: `Use at most ${MAX_STIMULUS_TILES} option tiles.` };
  if (!clean.some((t) => t.correct)) return { error: "Mark at least one tile as correct." };
  let r = 0, x = 0;
  const points = clean.map((t) => ({ id: t.correct ? `s${++r}` : `sx${++x}`, text: t.text, relevant: t.correct }));
  return { points };
}

export async function saveBuiltCase(env, body, session, built, meta = {}) {
  const id = newId("case");
  const failedParts = Array.isArray(meta.failedParts) ? meta.failedParts : [];
  const extras = cleanCaseExtras(body);
  if (extras.error) throw new Error(extras.error);
  const format = formatFromBody(body);
  await env.DB.prepare(
    `INSERT INTO cases (id, title, image_data, task_text, task_chunks, formal, stimulus_points, own_content_prompt, own_content_keywords, components, answer_key, model_letter, status, created_by, required_text, required_image, hunch_hint, build_flags, format)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, body.title, body.imageData || null, body.taskText, JSON.stringify(built.taskChunks), format === "formal_letter" ? 1 : 0,
    JSON.stringify(built.stimulusPoints), body.ownContentPrompt || "", JSON.stringify(built.ownContentKeywords || []),
    JSON.stringify(built.components), JSON.stringify(built.answerKey), body.modelLetter, "draft", session.username,
    extras.requiredText, extras.requiredImageData, extras.hunchHint,
    failedParts.length ? JSON.stringify({ failedParts, at: new Date().toISOString() }) : null,
    format
  ).run();
  return { id, built, format, ...meta, failedParts, failedLabels: failedParts.map(partLabel), status: "draft" };
}

/** Optional v1.12 fields accepted when a case is created. */
export function cleanCaseExtras(body) {
  const requiredText = String(body.requiredText || "").trim().slice(0, MAX_REQUIRED_TEXT_LEN);
  const hunchHint = String(body.hunchHint || "").trim().slice(0, MAX_HINT_LEN);
  let requiredImageData = null;
  if (body.requiredImageData) {
    const err = validateImageData(String(body.requiredImageData));
    if (err) return { error: "Required-points picture: " + err };
    requiredImageData = String(body.requiredImageData);
  }
  return { requiredText, hunchHint, requiredImageData };
}

export async function adminCreateCase(env, request, session) {
  const body = await request.json().catch(() => ({}));
  const required = ["title", "taskText", "keyInfo", "modelLetter"];
  for (const f of required) {
    if (!body[f] || (Array.isArray(body[f]) && body[f].length < 5)) return json({ error: `Missing field: ${f}` }, 400);
  }
  const format = formatFromBody(body);
  const extras = cleanCaseExtras(body);
  if (extras.error) return json({ error: extras.error }, 400);
  try {
    const result = await aiBuildCase(env, body, format);
    return json(await saveBuiltCase(env, body, session, result.built, {
      aiUsed: result.allAiUsed, anyAiUsed: result.anyAiUsed, aiDetail: result.aiDetail, usedManualFallback: false,
      failedParts: result.failedParts,
    }));
  } catch (e) {
    const fallback = buildManualFallbackCase(body, format);
    return json(await saveBuiltCase(env, body, session, fallback, {
      aiUsed: false, anyAiUsed: false, aiDetail: { failed: true, error: String(e?.message || e) }, usedManualFallback: true,
      failedParts: [...componentKeysFor(format), "taskChunks", "stimulus"],
    }));
  }
}

export async function adminCreateManualCase(env, request, session) {
  const body = await request.json().catch(() => ({}));
  const required = ["title", "taskText", "keyInfo", "modelLetter", "components"];
  for (const f of required) {
    if (!body[f] || (Array.isArray(body[f]) && body[f].length === 0)) return json({ error: `Missing field: ${f}` }, 400);
  }
  if (!Array.isArray(body.keyInfo) || body.keyInfo.length !== 5 || body.keyInfo.some((s) => typeof s !== "string" || !s.trim())) {
    return json({ error: "keyInfo must contain exactly 5 non-empty strings." }, 400);
  }
  const manualKeys = componentKeysFor(formatFromBody(body));
  if (!Array.isArray(body.components) || body.components.length !== manualKeys.length) return json({ error: "Manual case must contain exactly 13 parts." }, 400);
  for (let i = 0; i < body.components.length; i++) {
    const c = body.components[i];
    const opts = Array.isArray(c?.options) ? c.options.filter((o) => o && typeof o.text === "string" && o.text.trim()) : [];
    if (opts.length !== 3) return json({ error: `Part ${i + 1} (${manualKeys[i]}) must have exactly 3 non-empty options.` }, 400);
    if (!["a", "b", "c"].includes(c.correctId)) return json({ error: `Part ${i + 1} (${manualKeys[i]}) needs a correctId of "a", "b" or "c".` }, 400);
  }
  const extras = cleanCaseExtras(body);
  if (extras.error) return json({ error: extras.error }, 400);
  if (body.taskChunks !== undefined && body.taskChunks !== null) {
    const chunkCheck = normaliseTaskChunks(body.taskChunks);
    if (chunkCheck.error) return json({ error: "Step 1: " + chunkCheck.error }, 400);
  }
  if (body.stimulusTiles !== undefined && body.stimulusTiles !== null) {
    const tileCheck = buildStimulusPointsFromTiles(body.stimulusTiles);
    if (tileCheck.error) return json({ error: "Step 2: " + tileCheck.error }, 400);
  }
  const built = buildManualCaseFromComponents(body, formatFromBody(body), body.components);
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
export async function adminUpdateCaseImage(env, request, caseId, session) {
  const body = await request.json().catch(() => ({}));
  const imageData = String(body.imageData || "");
  if (!imageData) return json({ error: "imageData is required" }, 400);
  const imageErr = validateImageData(imageData);
  if (imageErr) return json({ error: imageErr }, imageErr.startsWith("Image is too large") ? 413 : 400);
  const row = await env.DB.prepare("SELECT id FROM cases WHERE id = ?").bind(caseId).first();
  if (!row) return json({ error: "Case not found" }, 404);
  await env.DB.prepare("UPDATE cases SET image_data = ?, status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?").bind(imageData, caseId).run();
  return json({ ok: true, caseId, savedBy: session.username, status: "draft" });
}

export async function adminSaveCaseComponents(env, request, caseId, session) {
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
  if (new Set(keys).size !== 13 || JSON.stringify(keys) !== JSON.stringify(componentKeysFor(normaliseFormat(row)))) {
    return json({ error: "Components must be in the standard 13-part order." }, 400);
  }
  // v1.12: a flagged (AI-failed) part counts as fixed once the teacher changes
  // its text/correct answer, or explicitly ticks "I've checked this part".
  let oldComps = [], oldAnswers = {};
  try { oldComps = JSON.parse(row.components || "[]"); oldAnswers = JSON.parse(row.answer_key || "{}")?.components || {}; } catch (e) { /* ignore */ }
  const confirmed = new Set(Array.isArray(body.confirmedParts) ? body.confirmedParts : []);
  const resolved = [];
  for (const c of clean) {
    const before = oldComps.find((o) => o.key === c.key);
    const changed = !before
      || (oldAnswers[c.key] || "a") !== answer.components[c.key]
      || before.options.map((o) => o.text).join("\u0001") !== c.options.map((o) => o.text).join("\u0001");
    if (changed || confirmed.has(c.key)) resolved.push(c.key);
  }
  const newFlags = buildFlagsJsonWithout(row.build_flags, resolved);
  await env.DB.prepare("UPDATE cases SET components = ?, answer_key = ?, build_flags = ?, status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?")
    .bind(JSON.stringify(clean), JSON.stringify(answer), newFlags, caseId).run();
  return json({ ok: true, savedBy: session.username, components: clean, answerKey: answer, failedParts: parseBuildFlags(newFlags).failedParts });
}

/** Step 1 editor: teacher decides which chunks are Purpose / Audience /
 * Context / Optional (never affects the score) / Not needed. */
export async function adminSaveCaseBriefing(env, request, caseId, session) {
  const body = await request.json().catch(() => ({}));
  const row = await env.DB.prepare("SELECT id, build_flags FROM cases WHERE id = ?").bind(caseId).first();
  if (!row) return json({ error: "Case not found" }, 404);
  const norm = normaliseTaskChunks(body.chunks);
  if (norm.error) return json({ error: norm.error }, 400);
  const flags = buildFlagsJsonWithout(row.build_flags, ["taskChunks"]);
  await env.DB.prepare("UPDATE cases SET task_chunks = ?, build_flags = ?, status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?")
    .bind(JSON.stringify(norm.chunks), flags, caseId).run();
  return json({ ok: true, savedBy: session.username, chunks: norm.chunks, status: "draft" });
}

/** Step 2 editor: required content points (text and/or picture) shown to
 * pupils, plus up to 12 option tiles marked correct / distractor. */
export async function adminSaveCaseEvidence(env, request, caseId, session) {
  const body = await request.json().catch(() => ({}));
  const row = await env.DB.prepare("SELECT id, build_flags, required_image FROM cases WHERE id = ?").bind(caseId).first();
  if (!row) return json({ error: "Case not found" }, 404);
  const built = buildStimulusPointsFromTiles(body.tiles);
  if (built.error) return json({ error: built.error }, 400);
  const requiredText = String(body.requiredText || "").trim().slice(0, MAX_REQUIRED_TEXT_LEN);
  let requiredImage = row.required_image || null;           // undefined => keep
  if (body.requiredImageData === null || body.requiredImageData === "") requiredImage = null; // explicit clear
  else if (typeof body.requiredImageData === "string") {
    const err = validateImageData(body.requiredImageData);
    if (err) return json({ error: "Required-points picture: " + err }, 400);
    requiredImage = body.requiredImageData;
  }
  const flags = buildFlagsJsonWithout(row.build_flags, ["stimulus"]);
  await env.DB.prepare("UPDATE cases SET stimulus_points = ?, required_text = ?, required_image = ?, build_flags = ?, status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?")
    .bind(JSON.stringify(built.points), requiredText, requiredImage, flags, caseId).run();
  return json({ ok: true, savedBy: session.username, stimulusPoints: built.points, status: "draft" });
}

/** Step 3 editor: optional pupil-facing hint. Empty string removes it (and
 * with it the Hint button). */
export async function adminSaveCaseHint(env, request, caseId, session) {
  const body = await request.json().catch(() => ({}));
  const row = await env.DB.prepare("SELECT id FROM cases WHERE id = ?").bind(caseId).first();
  if (!row) return json({ error: "Case not found" }, 404);
  const hint = String(body.hint || "").trim();
  if (hint.length > MAX_HINT_LEN) return json({ error: `Keep the hint under ${MAX_HINT_LEN} characters.` }, 400);
  await env.DB.prepare("UPDATE cases SET hunch_hint = ?, status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?")
    .bind(hint, caseId).run();
  return json({ ok: true, savedBy: session.username, hint, status: "draft" });
}

