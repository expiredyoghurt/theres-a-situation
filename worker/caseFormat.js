// v2.3 — change a case's writing format (formal letter / informal letter / article) after it was built.
import { normaliseFormat } from "./marking.js";
import { json } from "./common.js";
import { buildFlagsJsonWithout, parseBuildFlags, partLabel } from "./adminCases.js";
import { COMPONENT_LABELS, aiSingleComponent, buildOptionComponent, componentKeysFor, defaultBreaksFor, fallbackComponentSet } from "./adminSubmissions.js";

export const FORMATS = ["formal_letter", "informal_letter", "article"];
const REGISTER_KEYS = ["salutation", "greeting", "closing", "signoff", "name"]; // wording depends on formal vs informal
const CROSS_KEYS = ["purpose", "context"];                                      // phrased differently in a letter and an article

/** Pure planning step (unit-tested): which target parts can be kept and which must be rebuilt. */
export function planFormatChange(existingKeys, target, { rebuildRegister = false } = {}) {
  const targetKeys = componentKeysFor(target);
  const has = new Set(existingKeys);
  const fromArticle = has.has("headline");
  const toArticle = target === "article";
  const crossing = fromArticle !== toArticle;
  const keysMatch = targetKeys.every((k) => has.has(k)) && existingKeys.length === targetKeys.length;
  const rebuild = [];
  for (const k of targetKeys) {
    if (!has.has(k)) rebuild.push(k);
    else if (crossing && CROSS_KEYS.includes(k)) rebuild.push(k);
    else if (!crossing && rebuildRegister && REGISTER_KEYS.includes(k)) rebuild.push(k);
  }
  return { targetKeys, keysMatch, crossing, rebuild, keep: targetKeys.filter((k) => !rebuild.includes(k)) };
}

const parseJson = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };

export async function adminSetCaseFormat(env, request, caseId, session) {
  const body = await request.json().catch(() => ({}));
  const target = String(body.format || "");
  if (!FORMATS.includes(target)) return json({ error: "Choose formal letter, informal letter or article." }, 400);
  const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(caseId).first();
  if (!row) return json({ error: "Case not found" }, 404);

  const comps = parseJson(row.components, null);
  const answer = parseJson(row.answer_key, null);
  if (!Array.isArray(comps) || !answer || typeof answer !== "object") return json({ error: "This case's Step 4 data is damaged, so its format cannot be changed. Delete and re-import it." }, 422);
  const existingKeys = comps.map((c) => c && c.key);
  const plan = planFormatChange(existingKeys, target, { rebuildRegister: body.rebuildRegister === true });
  const current = normaliseFormat(row);
  const formalFlag = target === "formal_letter" ? 1 : 0;

  if (current === target && plan.keysMatch && plan.rebuild.length === 0) return json({ ok: true, unchanged: true, format: target });

  const byKey = Object.fromEntries(comps.map((c) => [c.key, c]));
  const answers = (answer && answer.components) || {};
  const full = {
    taskText: row.task_text, task_text: row.task_text,
    stimulusPoints: parseJson(row.stimulus_points, []),
    ownContentKeywords: parseJson(row.own_content_keywords, []),
    ownContentPrompt: row.own_content_prompt || "", own_content_prompt: row.own_content_prompt || "",
  };

  // Rebuild what must change, in parallel; an AI miss falls back to a template and is flagged for the teacher.
  const failed = [];
  const made = {};
  await Promise.all(plan.rebuild.map(async (key) => {
    let set = null;
    try { set = await aiSingleComponent(env, key, full, target); } catch (e) { set = null; }
    if (!set) { set = fallbackComponentSet(key, full, target); failed.push(key); }
    made[key] = buildOptionComponent(key, COMPONENT_LABELS(key, target), set);
  }));

  const newComps = [], newAnswers = {};
  for (const key of plan.targetKeys) {
    if (made[key]) { const { correctId, ...c } = made[key]; newComps.push(c); newAnswers[key] = correctId; }
    else { const o = byKey[key]; newComps.push({ key, label: COMPONENT_LABELS(key, target), options: o.options }); newAnswers[key] = answers[key] || "a"; }
  }
  const oldBreaks = Array.isArray(answer.paragraphBreaks) ? answer.paragraphBreaks : [];
  const breaks = !plan.crossing && oldBreaks.length && oldBreaks.every((k) => plan.targetKeys.includes(k)) ? oldBreaks : defaultBreaksFor(target);

  const cur = parseBuildFlags(row.build_flags);
  const stillFailed = cur.failedParts.filter((k) => !plan.rebuild.includes(k) && (["taskChunks", "stimulus"].includes(k) || plan.targetKeys.includes(k)));
  const flagList = Array.from(new Set([...stillFailed, ...failed]));
  const flags = flagList.length ? JSON.stringify({ failedParts: flagList, at: new Date().toISOString() }) : null;

  await env.DB.prepare("UPDATE cases SET format = ?, formal = ?, components = ?, answer_key = ?, build_flags = ?, status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?")
    .bind(target, formalFlag, JSON.stringify(newComps), JSON.stringify({ components: newAnswers, paragraphBreaks: breaks }), flags, caseId).run();

  const warnings = [];
  if (row.model_letter && (plan.crossing || body.rebuildRegister === true || current !== target)) warnings.push("The model answer was not changed. Edit it so it matches the new format.");
  if (!row.model_letter) warnings.push("This case has no model answer.");
  return json({
    ok: true, format: target, previousFormat: current, savedBy: session.username, status: "draft",
    kept: plan.keep, rebuilt: plan.rebuild, failedParts: flagList, failedLabels: flagList.map(partLabel), warnings,
  });
}
