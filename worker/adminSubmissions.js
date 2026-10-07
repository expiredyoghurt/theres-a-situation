// v2.0 — extracted from the v1.x single-file worker without behaviour changes.
import { ERROR_LABELS, isArticleFormat, normaliseFormat, realisticKeyInfoDistractors } from "./marking.js";
import { buildFlagsJsonWithout, buildStimulusPointsFromTiles, normaliseTaskChunks, parseBuildFlags, partLabel } from "./adminCases.js";
import { callAI, parseAiJson } from "./ai.js";
import { getTeacherClasses } from "./auth.js";
import { json } from "./common.js";
import { MAX_OVERRIDE_COMMENT_LEN } from "./config.js";
import { findFullCase, fullCaseFromRow } from "./overview.js";
import { applyTeacherScores } from "./scoring.js";

// ---------- submissions: review + teacher override ----------

/** Resolve which player_class values this session may see. */
export async function allowedClassesFor(env, session, requestedClass) {
  const wanted = (requestedClass || "").trim().toUpperCase();
  if (session.role === "admin") return { classes: wanted ? [wanted] : null }; // null = no filter
  const assigned = (await getTeacherClasses(env, session.userId)).map((c) => c.toUpperCase());
  if (wanted) {
    if (!assigned.includes(wanted)) return { error: json({ error: "You are not assigned to that class" }, 403) };
    return { classes: [wanted] };
  }
  return { classes: assigned };
}

export async function adminListSubmissions(env, session, url) {
  const scope = await allowedClassesFor(env, session, url.searchParams.get("class"));
  if (scope.error) return scope.error;
  if (scope.classes && !scope.classes.length) return json({ submissions: [], needsReviewCount: 0 });
  const onlyNeeds = url.searchParams.get("status") === "needs";
  const limit = Math.min(100, Number(url.searchParams.get("limit")) || 50);
  const where = [];
  const binds = [];
  if (scope.classes) { where.push(`player_class IN (${scope.classes.map(() => "?").join(",")})`); binds.push(...scope.classes); }
  const listWhere = [...where, ...(onlyNeeds ? ["needs_review = 1"] : [])];
  const listSql = `SELECT id, case_title, player_name, player_class, max_score, ai_score, final_score, needs_review, level, moe_json, final_moe_json,
      (override_comment IS NOT NULL) AS overridden, created_at
    FROM submissions ${listWhere.length ? "WHERE " + listWhere.join(" AND ") : ""}
    ORDER BY needs_review DESC, created_at DESC LIMIT ?`;
  const countSql = `SELECT COUNT(*) AS n FROM submissions WHERE ${[...where, "needs_review = 1"].join(" AND ")}`;
  try {
    const { results } = await env.DB.prepare(listSql).bind(...binds, limit).all();
    const countRow = await env.DB.prepare(countSql).bind(...binds).first();
    return json({
      submissions: (results || []).map((r) => ({
        id: r.id, caseTitle: r.case_title, playerName: r.player_name, playerClass: r.player_class,
        max: r.max_score, score: r.final_score ?? r.ai_score, aiScore: r.ai_score,
        needsReview: !!r.needs_review, overridden: !!r.overridden, createdAt: r.created_at,
        level: r.level || 1,
        moe: (() => { try { return JSON.parse(r.final_moe_json || r.moe_json || "null"); } catch (e) { return null; } })(),
      })),
      needsReviewCount: countRow?.n || 0,
    });
  } catch (e) {
    return json({ submissions: [], needsReviewCount: 0, note: "Submissions table not available yet." });
  }
}

export async function loadSubmissionForSession(env, session, id) {
  const row = await env.DB.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
  if (!row) return { error: json({ error: "Submission not found" }, 404) };
  if (session.role !== "admin") {
    const assigned = (await getTeacherClasses(env, session.userId)).map((c) => c.toUpperCase());
    if (!assigned.includes((row.player_class || "").toUpperCase())) return { error: json({ error: "You are not assigned to that pupil's class" }, 403) };
  }
  return { row };
}

export async function adminGetSubmission(env, session, id) {
  const { row, error } = await loadSubmissionForSession(env, session, id);
  if (error) return error;
  let caseInfo = {};
  try {
    const full = await findFullCase(env, row.case_id);
    if (full) {
      // v1.13: everything a teacher needs to build a marking prompt for an
      // external AI. This endpoint is admin/teacher-only, so correct answers are fine here.
      const ideaGroups = Array.isArray(full.ownContentKeywords) ? full.ownContentKeywords : [];
      caseInfo = {
        modelLetter: full.model_letter, ownContentPrompt: full.own_content_prompt ?? full.ownContentPrompt ?? "", taskText: full.task_text ?? full.taskText ?? "",
        formal: !!full.formal, format: normaliseFormat(full),
        keyInfo: (full.stimulusPoints || []).filter((p) => p.relevant).map((p) => p.text),
        acceptableIdeas: ideaGroups.map((g) => (Array.isArray(g) ? g : [g]).map((x) => String(x)).filter(Boolean)).filter((g) => g.length),
        requiredText: full.requiredText || "",
        hasRequiredImage: !!full.requiredImageData,
      };
    }
  } catch (e) { /* case may have been deleted — still show the submission */ }
  const parse = (x, d) => { try { return x ? JSON.parse(x) : d; } catch (e) { return d; } };
  return json({
    id: row.id, caseId: row.case_id, caseTitle: row.case_title, playerName: row.player_name, playerClass: row.player_class,
    createdAt: row.created_at, ownContent: row.own_content || "", letter: row.letter || "", letterEdited: !!row.letter_edited,
    max: row.max_score, aiScore: row.ai_score, aiBreakdown: parse(row.ai_breakdown, {}),
    finalScore: row.final_score, finalBreakdown: parse(row.final_breakdown, null),
    aiFailures: parse(row.ai_failures, []), needsReview: !!row.needs_review,
    overrideComment: row.override_comment || "", overriddenBy: row.overridden_by || "", overriddenAt: row.overridden_at || "",
    level: row.level || 1, moe: parse(row.moe_json, null), finalMoe: parse(row.final_moe_json, null),
    errorFlags: parse(row.error_flags, []).map((code) => ({ code, label: ERROR_LABELS[code] || code })),
    ...caseInfo,
  });
}

/** Teacher override: replace the automatic score with fresh per-criterion
 * scores plus a required explanatory comment — or revert to the automatic
 * score. Updates the leaderboard row so every view reflects the change. */
export function lbBreakdownJson(breakdown, moe) {
  const b = typeof breakdown === "string" ? (() => { try { return JSON.parse(breakdown); } catch (e) { return {}; } })() : (breakdown || {});
  const out = { ...b };
  if (moe && moe.taskFulfilment && moe.languageOrg) out._moe = { taskFulfilment: moe.taskFulfilment.score, languageOrg: moe.languageOrg.score };
  return JSON.stringify(out);
}

export async function adminGradeSubmission(env, request, session, id) {
  const { row, error } = await loadSubmissionForSession(env, session, id);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  let autoBreakdown;
  try { autoBreakdown = JSON.parse(row.ai_breakdown); } catch (e) { return json({ error: "Stored breakdown is unreadable." }, 500); }
  const autoMoe = (() => { try { return JSON.parse(row.moe_json || "null"); } catch (e) { return null; } })();

  if (body.revert) {
    const failures = (() => { try { return JSON.parse(row.ai_failures || "[]"); } catch (e) { return []; } })();
    await env.DB.prepare("UPDATE submissions SET final_score = NULL, final_breakdown = NULL, final_moe_json = NULL, override_comment = NULL, overridden_by = NULL, overridden_at = NULL, needs_review = ? WHERE id = ?")
      .bind(failures.length ? 1 : 0, id).run();
    if (row.leaderboard_id) {
      await env.DB.prepare("UPDATE leaderboard SET score = ?, breakdown = ? WHERE id = ?").bind(row.ai_score, lbBreakdownJson(row.ai_breakdown, autoMoe), row.leaderboard_id).run();
    }
    return json({ ok: true, reverted: true, score: row.ai_score });
  }

  const comment = String(body.comment || "").trim();
  if (!comment) return json({ error: "Please add a comment explaining why you changed the score." }, 400);
  if (comment.length > MAX_OVERRIDE_COMMENT_LEN) return json({ error: `Keep the comment under ${MAX_OVERRIDE_COMMENT_LEN} characters.` }, 400);
  const applied = applyTeacherScores(autoBreakdown, body.scores || {});
  if (applied.error) return json({ error: applied.error }, 400);

  // v1.14: optional teacher override of the MOE-style estimate (Task Fulfilment /6, Language & Organisation /8)
  let finalMoe = null;
  const ms = body.moeScores;
  if (ms && typeof ms === "object" && ((ms.taskFulfilment !== undefined && ms.taskFulfilment !== "") || (ms.languageOrg !== undefined && ms.languageOrg !== ""))) {
    const pick = (v, fallback, max, label) => {
      if (v === undefined || v === "") return { v: fallback };
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > max) return { err: `${label} must be between 0 and ${max}.` };
      return { v: Math.round(n) };
    };
    const tf = pick(ms.taskFulfilment, autoMoe ? autoMoe.taskFulfilment.score : 0, 6, "Task Fulfilment");
    if (tf.err) return json({ error: tf.err }, 400);
    const lo = pick(ms.languageOrg, autoMoe ? autoMoe.languageOrg.score : 0, 8, "Language & Organisation");
    if (lo.err) return json({ error: lo.err }, 400);
    finalMoe = { taskFulfilment: { score: tf.v, max: 6 }, languageOrg: { score: lo.v, max: 8 }, total: tf.v + lo.v, max: 14, estimate: false, teacherScored: true };
  }

  const when = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE submissions SET final_score = ?, final_breakdown = ?, final_moe_json = ?, override_comment = ?, overridden_by = ?, overridden_at = ?, needs_review = 0 WHERE id = ?"
  ).bind(applied.total, JSON.stringify(applied.breakdown), finalMoe ? JSON.stringify(finalMoe) : null, comment, session.username, when, id).run();
  if (row.leaderboard_id) {
    await env.DB.prepare("UPDATE leaderboard SET score = ?, breakdown = ? WHERE id = ?")
      .bind(applied.total, lbBreakdownJson(applied.breakdown, finalMoe || autoMoe), row.leaderboard_id).run();
  }
  return json({ ok: true, score: applied.total, max: applied.max, gradedBy: session.username, gradedAt: when, moe: finalMoe });
}

export async function adminRegenerateCasePart(env, request, caseId) {
  const body = await request.json().catch(() => ({}));
  const part = (body.part || "").toString();
  const row = await env.DB.prepare("SELECT * FROM cases WHERE id = ?").bind(caseId).first();
  if (!row) return json({ error: "Case not found" }, 404);
  const full = fullCaseFromRow(row);
  // v1.12: track whether AI actually produced this part. If it didn't, a
  // template is inserted AND the part is flagged so the teacher fixes it.
  let aiOk = true;
  const rowFormat = normaliseFormat(row);
  if (componentKeysFor(rowFormat).includes(part)) {
    const generated = await aiSingleComponent(env, part, full, rowFormat);
    aiOk = !!generated;
    const current = full.components.find((c) => c.key === part);
    const label = current?.label || COMPONENT_LABELS(part, rowFormat);
    const newComp = buildOptionComponent(part, label, generated || fallbackComponentSet(part, full, rowFormat));
    full.components = full.components.map((c) => c.key === part ? { key: part, label, options: newComp.options } : c);
    full.answerKey.components[part] = newComp.correctId;
  } else if (part === "taskChunks") {
    const ai = await aiTaskChunks(env, row.task_text);
    aiOk = !!ai;
    full.taskChunks = ai || fallbackTaskChunks(row.task_text);
  } else if (part === "stimulus") {
    const keyInfo = full.stimulusPoints.filter((p) => p.relevant).map((p) => p.text);
    const extra = await aiStimulusDistractors(env, keyInfo, row.task_text);
    aiOk = !!extra;
    full.stimulusPoints = [...keyInfo.map((text, i) => ({ id: `s${i+1}`, text, relevant: true })), ...(extra || ["Extra flavour detail not required in your letter"]).map((text, i) => ({ id:`sx${i+1}`, text, relevant:false }))];
  } else if (part === "ownContentKeywords") {
    const ai = await aiOwnContentKeywords(env, row.own_content_prompt, null);
    aiOk = !!ai;
    full.ownContentKeywords = ai || full.ownContentKeywords || [];
  } else {
    return json({ error: `Unknown or non-regeneratable part: ${part}` }, 400);
  }
  let flagsJson = row.build_flags || null;
  const flaggable = part === "ownContentKeywords" ? null : part;
  if (flaggable) {
    if (aiOk) flagsJson = buildFlagsJsonWithout(row.build_flags, [flaggable]);
    else {
      const cur = parseBuildFlags(row.build_flags);
      flagsJson = JSON.stringify({ failedParts: Array.from(new Set([...cur.failedParts, flaggable])), at: new Date().toISOString() });
    }
  }
  await env.DB.prepare("UPDATE cases SET task_chunks = ?, stimulus_points = ?, own_content_keywords = ?, components = ?, answer_key = ?, build_flags = ?, status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?")
    .bind(JSON.stringify(full.taskChunks), JSON.stringify(full.stimulusPoints), JSON.stringify(full.ownContentKeywords), JSON.stringify(full.components), JSON.stringify(full.answerKey), flagsJson, caseId).run();
  return json({
    ok: true, part, built: full, aiOk,
    ...(aiOk ? {} : { warning: `AI could not regenerate "${partLabel(part)}", so template text was put in its place. Please edit it manually in the case editor.` }),
    failedParts: parseBuildFlags(flagsJson).failedParts,
  });
}

export async function adminAiHealth(env) {
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
export const LETTER_COMPONENT_KEYS = [
  "salutation", "greeting", "purpose", "context", "keyinfo1", "keyinfo2", "keyinfo3", "keyinfo4", "keyinfo5", "ownIdea", "closing", "signoff", "name"
];
// v1.15 article: headline, byline (full name), opening hook, purpose, context, five key points,
// the pupil's own idea, a call to action and thanks to readers. Still 13 parts, so every
// "13 parts" editor, validator and array size keeps working.
export const ARTICLE_COMPONENT_KEYS = [
  "headline", "byline", "hook", "purpose", "context", "keyinfo1", "keyinfo2", "keyinfo3", "keyinfo4", "keyinfo5", "ownIdea", "cta", "thanks"
];
export const ARTICLE_ONLY_KEYS = new Set(["headline", "byline", "hook", "cta", "thanks"]);
export const FIXED_COMPONENT_KEYS = LETTER_COMPONENT_KEYS; // legacy alias (letters)
export const DEFAULT_BREAKS = {
  letter: ["greeting", "keyinfo1", "closing", "signoff"],
  article: ["hook", "keyinfo1", "cta"],
};
export function componentKeysFor(fmt) { return isArticleFormat(fmt) ? ARTICLE_COMPONENT_KEYS : LETTER_COMPONENT_KEYS; }
export function defaultBreaksFor(fmt) { return isArticleFormat(fmt) ? DEFAULT_BREAKS.article : DEFAULT_BREAKS.letter; }
/** New-case payloads send `format`; older clients send only `formal` (boolean). */
export function formatFromBody(body) {
  if (typeof body?.format === "string" && ["formal_letter", "informal_letter", "article"].includes(body.format)) return body.format;
  return body?.formal ? "formal_letter" : "informal_letter";
}

export function COMPONENT_LABELS(key, fmt) {
  const f = normaliseFormat(fmt);
  const formal = f === "formal_letter";
  if (f === "article") {
    return ({
      headline: "Headline", byline: "Byline (your full name)", hook: "Opening hook", purpose: "Purpose", context: "Context",
      keyinfo1: "Key information 1", keyinfo2: "Key information 2", keyinfo3: "Key information 3", keyinfo4: "Key information 4", keyinfo5: "Key information 5",
      ownIdea: "Own idea", cta: "Call to action", thanks: "Thanks to readers",
    })[key] || key;
  }
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

export function normaliseComponentSet(set) {
  if (!set || typeof set.correct !== "string" || !Array.isArray(set.distractors)) return null;
  const distractors = set.distractors.filter((s) => typeof s === "string" && s.trim()).slice(0, 2);
  if (!set.correct.trim() || distractors.length < 2) return null;
  return { correct: set.correct.trim(), distractors };
}

export async function aiSingleComponent(env, key, full, fmt) {
  const f = normaliseFormat(fmt);
  const formal = f === "formal_letter";
  const article = f === "article";
  const taskText = full.taskText || full.task_text || "";
  const keyInfo = full.stimulusPoints.filter((p) => p.relevant).map((p) => p.text);
  let instruction = "";
  if (/^keyinfo\d+$/.test(key)) {
    const n = Number(key.replace("keyinfo", ""));
    const target = keyInfo[n - 1] || "Add a relevant detail from the task.";
    instruction = `The correct sentence must convey this required information: ${JSON.stringify(target)}${article ? ". Write it as a flowing sentence in an article (a linking word such as Furthermore, Moreover or Additionally is welcome)." : ""}`;
  } else if (article && key === "headline") instruction = "Write a short, catchy headline (under 12 words, no full stop at the end) for the article.";
  else if (article && key === "byline") instruction = `Provide a natural example byline: the prefix "By " followed by a full name (first AND last name). Do not add any other label.`;
  else if (article && key === "hook") instruction = "Write ONE engaging opening sentence, ideally a question, that grabs the readers' attention about the topic without giving the details yet.";
  else if (article && key === "purpose") instruction = "Write the purpose of the article clearly in one friendly sentence for the readers (e.g. starting 'I am excited to share ...').";
  else if (article && key === "cta") instruction = "Write ONE call-to-action sentence that tells readers exactly what to do next (e.g. join, register, bring, remember).";
  else if (article && key === "thanks") instruction = "Write ONE sentence thanking the readers for reading, in a friendly tone.";
  else if (key === "salutation") instruction = `Write a suitable salutation for the stated audience. Formal register: ${formal}.`;
  else if (key === "greeting") instruction = formal ? "Write a brief formal introductory sentence before the purpose, without repeating the purpose." : "Write a brief friendly informal greeting sentence before the purpose.";
  else if (key === "purpose") instruction = "Write the purpose of the letter clearly in one sentence.";
  else if (key === "context") instruction = article ? "Write one concise sentence that gives the readers the background they need, from the writer's point of view." : "Write one concise sentence that gives the key situation/background the recipient needs.";
  else if (key === "ownIdea") instruction = `Suggest one strong pupil-generated idea answering: ${full.ownContentPrompt || full.own_content_prompt || "the own-content question"}.`;
  else if (key === "closing") instruction = formal ? "Write a polite formal closing sentence." : "Write a friendly informal closing sentence.";
  else if (key === "signoff") instruction = `Write the most appropriate sign-off phrase for a ${formal ? "formal" : "informal"} letter.`;
  else if (key === "name") instruction = `Provide a natural example first name (a surname is optional) that a pupil could sign the letter with. Do not add labels.`;
  else return null;
  const registerLine = article ? "FRIENDLY ARTICLE for a wider audience (schoolmates or neighbours); no salutation or sign-off." : formal ? "FORMAL." : "INFORMAL.";
  const prompt = `PSLE Situational Writing. Task: "${taskText}"\nFormat and register: ${registerLine}\nPart: ${COMPONENT_LABELS(key, f)}.\n${instruction}\nReturn STRICT JSON only: {"correct":"...","distractors":["...","..."]}. ${distractorGuidance(key, f)} Both distractors must be REALISTIC mistakes a Primary 6 pupil could actually make — similar length and tone to the correct sentence, never silly, rude or obviously off-topic. Keep sentences pupil-friendly and concise.`;
  return normaliseComponentSet(await aiSmallJson(env, prompt, 260));
}

/** What a REALISTIC wrong option looks like for each part of the letter. */
export function distractorGuidance(key, fmt) {
  const formal = normaliseFormat(fmt) === "formal_letter";
  if (/^keyinfo\d+$/.test(key)) return "Distractor 1: the same sentence but with ONE fact changed (a different date, time, place, name or number). Distractor 2: a vaguer, incomplete version that leaves out the key fact.";
  switch (key) {
    case "headline": return "Distractor 1: a dull label that ends with a full stop and has no appeal (e.g. 'Open House Details.'). Distractor 2: too long and vague, or written in text-speak.";
    case "byline": return "Distractor 1: a first name only. Distractor 2: a club or group name instead of the writer's own name.";
    case "hook": return "Distractor 1: a flat statement with no hook that just announces the event. Distractor 2: the wrong tone (rude, boastful or discouraging).";
    case "cta": return "Distractor 1: vague, so readers would not know what to do (e.g. 'Maybe come if you can.'). Distractor 2: bossy or threatening.";
    case "thanks": return "Distractor 1: an abrupt ending with no thanks. Distractor 2: text-speak (e.g. 'thx 4 reading, c u there').";
    case "salutation": return formal ? "Distractor 1: too casual for the reader (e.g. 'Hi ...,'). Distractor 2: the wrong title or an impersonal 'Dear Sir/Madam,' when the reader is named." : "Distractor 1: far too formal for a friend (e.g. 'Dear Sir/Madam,'). Distractor 2: the wrong name or title.";
    case "greeting": return formal ? "Distractor 1: too casual. Distractor 2: stiff and wordy in an unnatural way." : "Distractor 1: stiff and formal. Distractor 2: over-excited slang that sounds careless.";
    case "purpose": return "Distractor 1: states a related but WRONG purpose. Distractor 2: vague, so the reader would not know why you are writing.";
    case "context": return "Distractor 1: gives a weak or irrelevant reason. Distractor 2: gives a reason that contradicts the task.";
    case "ownIdea": return "Distractor 1: an idea that cannot work in this situation (e.g. it requires being there when the pupil cannot be). Distractor 2: an idea that is unrelated to the clues in the notice.";
    case "closing": return formal ? "Distractor 1: demanding or rude. Distractor 2: abrupt and casual." : "Distractor 1: bossy. Distractor 2: unenthusiastic and dismissive.";
    case "signoff": return formal ? "Distractor 1: the WRONG formal pairing for the salutation (Yours faithfully with a named reader, or Yours sincerely with Dear Sir/Madam). Distractor 2: too casual (e.g. 'Cheers,')." : "Distractor 1: too stiff (e.g. 'Yours faithfully,'). Distractor 2: a stiff business-style sign-off.";
    case "name": return formal ? "Distractor 1: first name only. Distractor 2: a title or description instead of a name." : "Distractor 1: a stiff full formal name with a title. Distractor 2: a description instead of a name.";
    default: return "Both distractors should be plausible but wrong for this part.";
  }
}

export function fallbackArticlePurposeSet() {
  return {
    correct: "I am excited to share the details with you and to encourage every one of you to take part.",
    distractors: ["I am writing to complain that nobody ever tells us anything about the event.", "I want to talk about school and a few other things in general."],
  };
}

export function fallbackComponentSet(key, full, fmt) {
  const f = normaliseFormat(fmt);
  const formal = f === "formal_letter";
  if (f === "article") {
    if (key === "headline") return { correct: "Come and Join Us for a Day to Remember!", distractors: ["Event Details.", "A Very Long Notice About Something That Is Happening At School Soon"] };
    if (key === "byline") return { correct: "By Wei Ming Tan", distractors: ["By Wei Ming", "By A Concerned Club"] };
    if (key === "hook") return { correct: "Have you ever wished for a chance to try something completely new at school?", distractors: ["There is an event at school.", "Nobody ever comes to these events, but I am telling you anyway."] };
    if (key === "purpose") return fallbackArticlePurposeSet();
    if (key === "context") return { correct: "As a member of our school community, I have seen how much events like this mean to all of us.", distractors: ["I have been very busy lately, so I only have a little to say.", "I know this may not matter much, but I thought I should mention it."] };
    if (key === "cta") return { correct: "So why not take part and sign up today?", distractors: ["Maybe you can come if you have nothing else to do.", "You must sign up now or you will be sorry."] };
    if (key === "thanks") return { correct: "Thank you for reading, and I hope to see you there!", distractors: ["That is all, bye.", "Thx 4 reading, c u there!"] };
  }
  if (key === "salutation") return fallbackSalutationSet(formal);
  if (key === "greeting") return formal ? { correct: "I hope this email finds you well.", distractors: ["Hope you are doing great!", "I trust that this email will reach you promptly."] } : { correct: "How are you? I hope you have been well!", distractors: ["I am writing to extend my warmest greetings to you.", "Hey!!! Long time no see!!!"] };
  if (key === "purpose") return fallbackPurposeSet(full.taskText || full.task_text || "You are writing to respond to the situation.");
  if (key === "context") return { correct: formal ? "I would like to explain the situation so that you have the necessary background." : "I thought I should explain what happened so you know the full story." , distractors: ["I know this may not matter much, but I thought I should mention it.", "I have been very busy lately, so I did not think about it earlier."] };
  if (/^keyinfo\d+$/.test(key)) {
    const n = Number(key.replace("keyinfo", "")); const pts = full.stimulusPoints.filter((p) => p.relevant).map((p) => p.text); const correct = pts[n-1] || `The fifth detail is relevant to the situation.`;
    const withStop = correct.endsWith(".") ? correct : correct + ".";
    return { correct: withStop, distractors: realisticKeyInfoDistractors(withStop) };
  }
  if (key === "ownIdea") {
    const groups = full.ownContentKeywords || []; const ideas = groups.slice(0,3).map((g) => g[0]).filter(Boolean);
    while (ideas.length < 3) ideas.push(["suggest a helpful idea", "offer another practical way to help", "contribute in another suitable way"][ideas.length]);
    return { correct: ideas[0], distractors: ideas.slice(1,3) };
  }
  if (key === "closing") return formal ? { correct: "Thank you for considering my suggestion.", distractors: ["Please reply as soon as possible, because I need your answer today.", "That is all, so goodbye."] } : { correct: "Hope to hear from you soon!", distractors: ["Thank you for your formal consideration of this correspondence.", "Reply quickly, or I will ask someone else."] };
  if (key === "signoff") return fallbackSignoffSet(formal);
  if (key === "name") return formal ? { correct: "Wei Ming Tan", distractors: ["Wei Ming", "A concerned pupil"] } : { correct: "Wei Ming", distractors: ["Mr Tan Wei Ming", "Your classmate from 5IG"] };
  return { correct: "This is the most suitable sentence for this part.", distractors: ["This is an unsuitable sentence.", "This sentence does not fit the task."] };
}

export function buildManualFallbackCase(body, fmt) {
  const keys = componentKeysFor(fmt);
  const keyInfo = Array.isArray(body.keyInfo) ? body.keyInfo.slice(0, 5) : [];
  while (keyInfo.length < 5) keyInfo.push(`Relevant detail ${keyInfo.length + 1} from the task.`);
  const scaffold = { taskText: body.taskText, task_text: body.taskText, stimulusPoints: keyInfo.map((text,i)=>({id:`s${i+1}`,text,relevant:true})), ownContentPrompt: body.ownContentPrompt || "Suggest one helpful idea for this situation.", ownContentKeywords: (body.ownContentIdeas || []).map(s=>[s]) };
  const builds = keys.map(key => buildOptionComponent(key, COMPONENT_LABELS(key, fmt), fallbackComponentSet(key, scaffold, fmt)));
  return { taskChunks: fallbackTaskChunks(body.taskText), stimulusPoints: scaffold.stimulusPoints, ownContentKeywords: scaffold.ownContentKeywords, components: builds.map(({correctId,...c})=>c), answerKey: {components:Object.fromEntries(builds.map(c=>[c.key,c.correctId])), paragraphBreaks: isArticleFormat(fmt) ? DEFAULT_BREAKS.article : ["purpose","keyinfo1","closing","signoff"]} };
}

export function buildManualCaseFromComponents(body, fmt, components) {
  const KEYS = componentKeysFor(fmt);
  const clean = components.map((c,i)=>({ key:KEYS[i], label:String(c.label || COMPONENT_LABELS(KEYS[i], fmt)).slice(0,120), options:["a","b","c"].map(id=>({id,text:String(c.options?.find(o=>o.id===id)?.text || "").trim().slice(0,500)})) }));
  const answerComponents={};
  components.forEach((c,i)=>answerComponents[KEYS[i]]=["a","b","c"].includes(c.correctId)?c.correctId:"a");
  // taskChunks and distractorStimulusPoints are optional extras only the
  // JSON-import path sends (see AI_CASE_TO_JSON_PROMPT.md); the in-app
  // manual-entry form never includes them, so both fall back to the
  // pre-existing behavior when absent, keeping that form unaffected.
  // v1.12: the editor now sends Step 1 chunks (with Optional / Not needed
  // types) and Step 2 tiles ({text, correct}, up to 12). The JSON-import path
  // still sends the older distractorStimulusPoints; both keep working.
  const chunkNorm = Array.isArray(body.taskChunks) && body.taskChunks.length ? normaliseTaskChunks(body.taskChunks) : null;
  const taskChunks = chunkNorm && chunkNorm.chunks ? chunkNorm.chunks : fallbackTaskChunks(body.taskText);
  const tileBuild = Array.isArray(body.stimulusTiles) && body.stimulusTiles.length ? buildStimulusPointsFromTiles(body.stimulusTiles) : null;
  const relevantPoints = (body.keyInfo||[]).slice(0,5).map((text,i)=>({id:`s${i+1}`,text:String(text).trim(),relevant:true}));
  const distractorPoints = Array.isArray(body.distractorStimulusPoints)
    ? body.distractorStimulusPoints.filter((s)=>typeof s === "string" && s.trim()).slice(0,2).map((text,i)=>({id:`sx${i+1}`,text:text.trim(),relevant:false}))
    : [];
  return { taskChunks, stimulusPoints: tileBuild && tileBuild.points ? tileBuild.points : [...relevantPoints, ...distractorPoints], ownContentKeywords:(body.ownContentIdeas||[]).map(s=>[s]), components:clean, answerKey:{components:answerComponents,paragraphBreaks: isArticleFormat(fmt) ? DEFAULT_BREAKS.article : ["purpose","keyinfo1","closing","signoff"]} };
}

export async function aiBuildCase(env, body, fmt) {
  const KEYS = componentKeysFor(fmt);
  const keyInfo = Array.isArray(body.keyInfo) ? body.keyInfo.slice(0, 5) : [];
  while (keyInfo.length < 5) keyInfo.push(`Relevant detail ${keyInfo.length + 1} from the task.`);
  const scaffold = { taskText: body.taskText, task_text: body.taskText, stimulusPoints: keyInfo.map((text, i) => ({ id:`s${i+1}`, text, relevant:true })), ownContentPrompt: body.ownContentPrompt, own_content_prompt: body.ownContentPrompt, ownContentKeywords: (body.ownContentIdeas || []).map((s) => [s]) };
  const componentResults = await Promise.all(KEYS.map((key) => aiSingleComponent(env, key, scaffold, fmt)));
  const aiDetail = {};
  const componentBuilds = componentResults.map((set, i) => {
    const key = KEYS[i]; aiDetail[key] = !!set;
    return buildOptionComponent(key, COMPONENT_LABELS(key, fmt), set || fallbackComponentSet(key, scaffold, fmt));
  });
  const components = componentBuilds.map(({ correctId, ...c }) => c);
  const aiDistractors = await aiStimulusDistractors(env, keyInfo, body.taskText);
  const finalStimulusPoints = [...keyInfo.map((text, i) => ({ id:`s${i+1}`, text, relevant:true })), ...(aiDistractors || ["Extra detail not required in the letter", "Interesting background detail not needed here"]).map((text, i) => ({ id:`sx${i+1}`, text, relevant:false }))];
  const taskChunks = await aiTaskChunks(env, body.taskText);
  const ownContentKeywords = await aiOwnContentKeywords(env, body.ownContentPrompt, body.ownContentIdeas);
  aiDetail.taskChunks = !!taskChunks; aiDetail.stimulus = !!aiDistractors; aiDetail.ownContentKeywords = !!ownContentKeywords;
  const answerKey = { components: Object.fromEntries(componentBuilds.map((c) => [c.key, c.correctId])), paragraphBreaks: defaultBreaksFor(fmt) };
  const flatFlags = KEYS.map((k) => aiDetail[k]).concat([aiDetail.taskChunks, aiDetail.stimulus, aiDetail.ownContentKeywords]);
  // v1.12: every AI-built part that fell back to template text is reported so
  // the teacher is told exactly which ones to fix by hand (Step 4 parts in
  // particular). own-content keywords are excluded: their fallback is the
  // teacher's own list of ideas, which is already usable as-is.
  const failedParts = [...KEYS.filter((k) => !aiDetail[k]), ...(aiDetail.taskChunks ? [] : ["taskChunks"]), ...(aiDetail.stimulus ? [] : ["stimulus"])];
  return { built: { taskChunks: taskChunks || fallbackTaskChunks(body.taskText), stimulusPoints: finalStimulusPoints, ownContentKeywords: ownContentKeywords || scaffold.ownContentKeywords, components, answerKey }, aiDetail, failedParts, allAiUsed: flatFlags.every(Boolean), anyAiUsed: flatFlags.some(Boolean) };
}

/** Shared helper: turn {correct, distractors:[3]} into a shuffled 4-option
 * component, returning which option id ended up correct. */
export function buildOptionComponent(key, label, set) {
  const distractors = (set.distractors || []).filter(Boolean).slice(0, 2);
  while (distractors.length < 2) distractors.push("This does not fit what the writing needs here.");
  const pool = [set.correct, ...distractors];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const ids = ["a", "b", "c"];
  const correctIndex = pool.indexOf(set.correct);
  return { key, label, options: pool.map((text, i) => ({ id: ids[i], text })), correctId: ids[correctIndex === -1 ? 0 : correctIndex] };
}

// ---- focused AI calls, one small JSON object each ----

export async function aiSmallJson(env, prompt, maxTokens = 220) {
  try {
    const text = await callAI(env, prompt, maxTokens);
    return parseAiJson(text);
  } catch (e) {
    return null;
  }
}

export async function aiTaskChunks(env, taskText) {
  const prompt = `Break this PSLE situational-writing task into short phrases and label each phrase's role.
Task: "${taskText}"
Reply with STRICT JSON only: {"chunks":[{"text":"<short phrase, a substring of the task>","type":"purpose|audience|context|other"}]}. Cover the whole task text, breaking at natural commas/clauses. Exactly one phrase should be "purpose" (what pupils must do) and one should be "audience" (who they are writing to); the rest are "context" or "other".`;
  const obj = await aiSmallJson(env, prompt, 300);
  if (!obj || !Array.isArray(obj.chunks) || !obj.chunks.length) return null;
  const valid = obj.chunks.filter((c) => c && typeof c.text === "string" && ["purpose", "audience", "context", "other"].includes(c.type));
  if (!valid.length) return null;
  return valid.map((c, i) => ({ id: `c${i + 1}`, text: c.text.trim(), type: c.type }));
}

export async function aiStimulusDistractors(env, keyInfo, taskText) {
  const prompt = `PSLE situational-writing task: "${taskText}"
The correct key information pupils must include: ${JSON.stringify(keyInfo)}
Write exactly 2 short PLAUSIBLE-SOUNDING but IRRELEVANT extra details (things that fit the scene but are NOT required in the letter). Reply with STRICT JSON only: {"distractors":["...","..."]}`;
  const obj = await aiSmallJson(env, prompt, 150);
  if (!obj || !Array.isArray(obj.distractors) || !obj.distractors.length) return null;
  const valid = obj.distractors.filter((s) => typeof s === "string" && s.trim());
  return valid.length ? valid.slice(0, 2) : null;
}

export async function aiOwnContentKeywords(env, ownContentPrompt, ownContentIdeas) {
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

export async function aiPurposeOption(env, taskText, formal) {
  const prompt = `PSLE situational-writing task: "${taskText}"
Register: ${formal ? "FORMAL" : "INFORMAL"}.
Write ONE sentence a pupil could use as the opening "purpose" line of their letter (e.g. "I am writing to..."), matching the task and register. Then write 3 similar-length but WRONG alternative sentences a pupil might realistically pick instead (a related-but-wrong purpose, wrong register, or vague). Never silly. Reply with STRICT JSON only: {"correct":"...","distractors":["...","...","..."]}`;
  const obj = await aiSmallJson(env, prompt, 250);
  if (!obj || typeof obj.correct !== "string" || !obj.correct.trim() || !Array.isArray(obj.distractors) || obj.distractors.length < 3) return null;
  return { correct: obj.correct.trim(), distractors: obj.distractors.slice(0, 3).map((s) => String(s).trim()) };
}

export async function aiFillerOption(env, taskText, formal) {
  const prompt = `PSLE situational-writing task: "${taskText}"
Register: ${formal ? "FORMAL" : "INFORMAL"}.
Write ONE short sentence that would naturally round off the middle of this letter (extra supporting context, before the closing), matching the register. Then write 3 similar-length but WRONG alternative sentences a pupil might realistically pick instead (irrelevant padding, weak reasons, or the wrong tone). Never silly. Reply with STRICT JSON only: {"correct":"...","distractors":["...","...","..."]}`;
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
export async function aiKeyInfoDistractorsBatch(env, keyInfoList, taskText) {
  if (!keyInfoList.length) return [];
  const corrected = keyInfoList.map((k) => (k.endsWith(".") ? k : k + "."));
  const prompt = `PSLE situational-writing task: "${taskText}"
Here are the CORRECT sentences for several parts of the letter, numbered in order:
${corrected.map((c, i) => `${i + 1}. ${c}`).join("\n")}
For EACH numbered sentence, write exactly 3 similar-length but WRONG alternative sentences a pupil might mistakenly pick instead of it. Make them REALISTIC slips: (1) the same sentence with one fact changed (date, time, place, name or number), (2) a vaguer version that leaves out the key fact, (3) a sentence in the wrong register. Never silly or off-topic. Reply with STRICT JSON only, one array of exactly 3 distractors per numbered item, in the same order:
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

export function fallbackTaskChunks(taskText) {
  const chunks = taskText.split(/(?<=[.,])\s+/).map((text, i) => ({
    id: `c${i + 1}`, text: text.trim(), type: i === 0 ? "context" : i === 1 ? "purpose" : "other",
  }));
  const audienceIdx = Math.max(1, chunks.length - 1);
  if (chunks[audienceIdx]) chunks[audienceIdx].type = "audience";
  return chunks;
}

export function fallbackSalutationSet(formal) {
  return formal
    ? { correct: "Dear Sir/Madam,", distractors: ["Hi there,", "Dear friend,", "To whom it may concern, hello,"] }
    : { correct: "Hi there,", distractors: ["Dear Sir/Madam,", "To whom it may concern,", "Respected Sir,"] };
}

export function fallbackSignoffSet(formal) {
  return formal
    ? { correct: "Yours faithfully,", distractors: ["Yours sincerely,", "Cheers,", "Best wishes always,"] }
    : { correct: "Best wishes,", distractors: ["Yours faithfully,", "Yours truly, The Management", "Sincerely yours truly,"] };
}

export function fallbackPurposeSet(taskText) {
  const purposeText = taskText.split(".")[0] + ".";
  return {
    correct: `I am writing to ${purposeText.toLowerCase().replace(/^you /, "").replace(/^i /, "")}`,
    distractors: [
      "I am writing to ask whether the event can be changed to suit me.",
      "I am writing to let you know about something, but it is not important.",
      "I am writing about the event, and I hope you can sort it out for me.",
    ],
  };
}

export function fallbackFillerSet(formal) {
  return {
    correct: formal
      ? "I hope this additional context is helpful for your consideration."
      : "Just thought I'd add a bit more info here!",
    distractors: [
      "I know this may not matter much, but I thought I should mention it.",
      "I have been very busy lately, so I did not think about it earlier.",
      "Many pupils will probably do the same thing, so it should be fine.",
    ],
  };
}

export function fallbackKeyInfoDistractors() {
  return [
    "I am not sure about the exact details, so please check again.",
    "I think the details have changed since the notice was printed.",
    "I did not note down the details, but it should be fine.",
  ];
}


