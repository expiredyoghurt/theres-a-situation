// v2.0 — extracted from the v1.x single-file worker without behaviour changes.
import { ERROR_LABELS, analyseLetter, buildChecklist, buildLetterExaminerPrompt, buildOwnIdeaPrompt, computeMoe, computeStars, deriveErrorFlags, docWord, expectedBodyParagraphs, fallbackLanguageOrg, fallbackOwnIdea, fallbackPac, isArticleFormat, looksLikeInjection, normaliseFormat, overallQualityFromMoe, ownIdeaFractionFromJudgement, parseLetterJudgement, parseOwnIdeaJudgement, pickFixTask, publicOptionId, scoreLetterContent, scoreParagraphing, wordCount } from "./marking.js";
import { aiGenerateStrongerVersion, callAI } from "./ai.js";
import { getRubric } from "./auth.js";
import { isBlockedTutorialCase, isStudentAccessEnabled } from "./casesPublic.js";
import { json } from "./common.js";
import { MAX_FINAL_LETTER_LEN, SUBMIT_BURST_LIMIT } from "./config.js";
import { findPlayableCase } from "./overview.js";

// ---------- scoring ----------

/** Map the option ids the pupil's browser saw (opaque, see publicOptionId) back to stored ids. */
export function remapChoices(full, raw) {
  const out = {};
  for (const comp of full.components || []) {
    const v = raw && raw[comp.key];
    if (!v) continue;
    if (v === "custom") { out[comp.key] = "custom"; continue; }
    const hit = (comp.options || []).find((o) => publicOptionId(full.id, comp.key, o.id) === v) || (comp.options || []).find((o) => o.id === v);
    if (hit) out[comp.key] = hit.id;
  }
  return out;
}

/** One small AI call, retried once if the model answered but not in the requested JSON shape. */
export async function aiExamine(env, prompt, maxTokens, parse) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let text = null;
    try { text = await callAI(env, prompt, maxTokens, { temperature: 0 }); } catch (e) { text = null; }
    if (!text) return null; // every provider failed — retrying would only add latency
    const parsed = parse(text);
    if (parsed) return parsed;
  }
  return null;
}

export async function submitCase(env, request, id) {
  if (!(await isStudentAccessEnabled(env))) return json({ error: "Student access is currently disabled." }, 403);
  if (await isBlockedTutorialCase(env, id)) return json({ error: "Tutorial cases are currently disabled." }, 403);
  const full = await findPlayableCase(env, id);
  if (!full) return json({ error: "Case not found" }, 404);
  const body = await request.json();
  const name = (body.name || "Anonymous Detective").toString().slice(0, 40);
  const playerClass = (body.playerClass || "").toString().slice(0, 20).trim().toUpperCase();
  // A random id generated once in the pupil's browser (see index.html) —
  // disambiguates two same-named pupils in the same class so their
  // scores don't merge into one row on the heatmap/misconceptions view.
  const deviceId = (body.deviceId || "").toString().trim().slice(0, 40);
  // v1.16: per-device cooldown so one browser cannot burn the shared AI quota.
  if (deviceId) {
    try {
      const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE device_id = ? AND created_at > datetime('now','-60 seconds')").bind(deviceId).first();
      if ((recent?.n || 0) >= SUBMIT_BURST_LIMIT) return json({ error: "Too many submissions in a minute. Take a breath, check your letter, and try again shortly." }, 429);
    } catch (e) { /* fail open */ }
  }
  const format = normaliseFormat(full);
  const isArticle = format === "article";
  // v1.14 writing ladder: 1 = guided (pick sentences), 2 = starters + own words, 3 = independent.
  const level = [1, 2, 3].includes(Number(body.level)) ? Number(body.level) : 1;
  const hideOnBoard = body.hideOnBoard ? 1 : 0;

  // Guided (Level 1) still needs a sign-off name to build the letter; at Levels 2-3 the pupil writes it themselves.
  let signOffName = "";
  if (level === 1) {
    const signOff = validateSignOffName(body.signOffName, format);
    if (!signOff.ok) return json({ error: signOff.error }, 400);
    signOffName = signOff.name;
  } else {
    signOffName = (body.signOffName || "").toString().trim().slice(0, 60);
  }

  const rubric = await getRubric(env);
  const w = rubric.weights;
  const total_max = rubric.total;
  const breakdown = {};

  // 1) Briefing — purpose / audience / context (a scaffold skill, not examined)
  const taskAnswers = body.taskAnswers || {}; // { chunkId: "purpose"|"audience"|"context"|"other" }
  const taskResult = scoreTaskIdentification(full.taskChunks, taskAnswers, w.taskIdentification);
  breakdown.taskIdentification = { score: taskResult.score, max: taskResult.max };

  // 2) Evidence board — pick the relevant notice details, avoid the distractors
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

  // 3) THE LETTER. v1.14: everything below is scored from the FINAL TEXT the
  // pupil submits, not from which MCQ options they clicked.
  const componentChoices = remapChoices(full, body.componentChoices || {});
  const componentResponses = body.componentResponses || {};
  const paragraphBreaks = new Set(body.paragraphBreaks || []);
  const assembledFromParts = level <= 2
    ? assembleLetter(full, componentChoices, paragraphBreaks, signOffName, componentResponses)
    : "";
  const finalLetterRaw = (body.finalLetter || "").toString().replace(/\r\n/g, "\n").trim().slice(0, MAX_FINAL_LETTER_LEN);
  const letterEdited = !!finalLetterRaw && finalLetterRaw !== assembledFromParts;
  const assembledLetter = finalLetterRaw || assembledFromParts;
  if (wordCount(assembledLetter) < 8) return json({ error: `Please write your ${docWord(format)} before you submit.` }, 400);

  const ownContent = (body.ownContent || "").toString().slice(0, 500);
  const relevantPoints = full.stimulusPoints.filter((p) => p.relevant).map((p) => ({ id: p.id, text: p.text }));
  const knownTexts = [
    ...full.stimulusPoints.map((p) => p.text),
    full.task_text || full.taskText || "",
    full.requiredText || full.required_text || "",
    full.model_letter || "",
  ];
  const analysis = analyseLetter(assembledLetter, {
    relevantPoints, knownTexts, ownContent, format,
    components: full.components, answerKey: full.answerKey,
    componentChoices: level === 1 ? componentChoices : {}, level,
  });
  const injection = looksLikeInjection(ownContent) || looksLikeInjection(assembledLetter);

  // Two small AI examiner calls in parallel (small JSON answers are what the
  // free-tier models are reliable at). Own idea is ALWAYS judged by the AI when
  // present — keyword lists can't tell a valid unlisted idea from gibberish.
  const ownHasText = ownContent.trim().length >= 8;
  const [ownJudgement, letterJudgement] = await Promise.all([
    ownHasText ? aiExamine(env, buildOwnIdeaPrompt(full, ownContent), 220, parseOwnIdeaJudgement) : Promise.resolve(null),
    aiExamine(env, buildLetterExaminerPrompt(full, assembledLetter, { format }), 420, parseLetterJudgement),
  ]);

  // Own idea
  const ownFallback = fallbackOwnIdea(ownContent, full.ownContentKeywords);
  const ownAiFailed = ownHasText && !ownJudgement;
  const ownFraction = ownJudgement ? ownIdeaFractionFromJudgement(ownJudgement) : ownFallback.fraction;
  const ownNote = ownJudgement ? ownJudgement.note : ownFallback.note;
  breakdown.ownContent = { score: Math.round(ownFraction * w.ownContent), max: w.ownContent, aiNote: ownNote || null, ...(ownAiFailed ? { aiFailed: true } : {}) };

  // Letter content & accuracy (the old "letterChoices" key, kept so history/heatmaps still line up)
  const content = scoreLetterContent(analysis, w.letterChoices);
  breakdown.letterChoices = {
    score: content.score, max: w.letterChoices,
    correctCount: analysis.coverage.filter((c) => c.status === "found").length, total: analysis.coverage.length,
  };

  // Paragraphing, read from the text
  const expectedBody = expectedBodyParagraphs(full.answerKey);
  const para = scoreParagraphing(analysis, expectedBody, w.paragraphing);
  breakdown.paragraphing = { score: para.score, max: w.paragraphing };

  // Language & organisation + purpose/audience/context (AI examiner; rule-based estimate if it fails)
  const letterAiFailed = !letterJudgement;
  const lo = letterJudgement ? { language: letterJudgement.language, organisation: letterJudgement.organisation } : fallbackLanguageOrg(assembledLetter, format);
  const pac = letterJudgement ? { purpose: letterJudgement.purpose, audience: letterJudgement.audience, context: letterJudgement.context } : fallbackPac(analysis);
  const estimateParts = [...(letterAiFailed ? ["languageOrg", "purposeAudienceContext"] : []), ...(ownAiFailed ? ["ownIdea"] : [])];
  const moe = computeMoe({ analysis, ownFraction, pac, lo, estimateParts });
  breakdown.overallQuality = {
    score: overallQualityFromMoe(moe, w.overallQuality), max: w.overallQuality,
    aiNote: letterJudgement ? letterJudgement.note : null,
    ...(letterAiFailed ? { aiFailed: true } : {}),
  };
  // v1.15: article cases also ask the examiner about headline / flow / call to action; if it says no, make sure it shows up as a flag.
  const articleJudgementFlags = [];
  if (isArticle && letterJudgement) {
    if (letterJudgement.cta === false) articleJudgementFlags.push("no-cta");
    if (letterJudgement.headline === false && analysis.fmt.hasTitle) articleJudgementFlags.push("no-title");
    if (letterJudgement.flow === false) articleJudgementFlags.push("list-like");
    // heuristics cannot tell "Wei Ming" (a given name) from "Wei Ming Tan", so the examiner is asked too
    if (letterJudgement.byline === false && analysis.fmt.hasByline) articleJudgementFlags.push("byline-first-name");
  }

  const totalPoints = Object.values(breakdown).reduce((s, b) => s + b.score, 0);

  // AI-failure flags -> teacher review queue (v1.12 mechanism, reused)
  const aiFailures = detectAiFailures({ ownNeedsAi: ownHasText, ownAiResult: ownJudgement, holisticNeedsAi: true, holisticAiResult: letterJudgement });
  if (injection) aiFailures.push({ part: "letter", label: "Possible instruction in the pupil's writing", reason: "The writing contains wording that looks aimed at the marker. A teacher should read it before the score is trusted." });

  const flags = Array.from(new Set([...deriveErrorFlags(analysis, { ownFraction, ownJudgement, pac, expectedBody, injection }), ...articleJudgementFlags]));
  const checklist = buildChecklist(analysis, { ownFraction, ownNote, ownJudgement, pac, aiErrors: letterJudgement ? letterJudgement.errors : [], expectedBody });
  const fixTask = pickFixTask(analysis, flags, ownJudgement);
  const stars = computeStars(breakdown, moe);

  // Below mastery threshold: ask the AI coach for a stronger rewrite the pupil can learn from.
  let improvement = null;
  if (totalPoints < rubric.masteryThreshold) {
    try {
      improvement = await aiGenerateStrongerVersion(env, full, assembledLetter, ownContent, totalPoints, total_max, rubric.masteryThreshold);
    } catch (e) { /* no improvement offered if every AI provider is unavailable */ }
  }

  const moeLite = { taskFulfilment: moe.taskFulfilment.score, languageOrg: moe.languageOrg.score };
  let leaderboardId = null;
  try {
    const ins = await env.DB.prepare(
      "INSERT INTO leaderboard (player_name, player_class, case_id, case_title, score, max_score, breakdown, device_id, hide_on_board) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(name, playerClass, full.id, full.title, totalPoints, total_max, JSON.stringify({ ...breakdown, _moe: moeLite }), deviceId, hideOnBoard).run();
    leaderboardId = ins?.meta?.last_row_id ?? null;
  } catch (e) {
    try {
      const ins = await env.DB.prepare(
        "INSERT INTO leaderboard (player_name, player_class, case_id, case_title, score, max_score, breakdown, device_id) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(name, playerClass, full.id, full.title, totalPoints, total_max, JSON.stringify({ ...breakdown, _moe: moeLite }), deviceId).run();
      leaderboardId = ins?.meta?.last_row_id ?? null;
    } catch (e2) { /* leaderboard table may not be migrated; still return the score */ }
  }

  // Keep the full submission so a teacher can review it and override the score later.
  const subBase = [leaderboardId, full.id, full.title, name, playerClass, deviceId, ownContent, assembledLetter, letterEdited ? 1 : 0,
    total_max, totalPoints, JSON.stringify(breakdown), JSON.stringify(aiFailures), aiFailures.length ? 1 : 0];
  try {
    await env.DB.prepare(
      `INSERT INTO submissions (leaderboard_id, case_id, case_title, player_name, player_class, device_id, own_content, letter, letter_edited, max_score, ai_score, ai_breakdown, ai_failures, needs_review, level, moe_json, error_flags)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(...subBase, level, JSON.stringify(moe), JSON.stringify(flags)).run();
  } catch (e) {
    try {
      await env.DB.prepare(
        `INSERT INTO submissions (leaderboard_id, case_id, case_title, player_name, player_class, device_id, own_content, letter, letter_edited, max_score, ai_score, ai_breakdown, ai_failures, needs_review)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(...subBase).run();
    } catch (e2) { /* submissions table unavailable — pupil still gets their score */ }
  }

  // Record each guided MCQ pick (Level 1 only) so the admin dashboard can surface class-wide misconceptions.
  if (level === 1) {
    try {
      const pickStmts = Object.keys(full.answerKey.components || {})
        .filter((key) => componentChoices[key] && componentChoices[key] !== "custom")
        .map((key) => env.DB.prepare(
          "INSERT INTO option_picks (case_id, case_title, component_key, option_id, player_class) VALUES (?,?,?,?,?)"
        ).bind(full.id, full.title, key, componentChoices[key], playerClass));
      if (pickStmts.length) await env.DB.batch(pickStmts);
    } catch (e) { /* option_picks table may not be migrated; safe to skip */ }
  }

  return json({
    score: totalPoints, max: total_max, threshold: rubric.masteryThreshold, breakdown, moe, format,
    assembledLetter, modelLetter: full.model_letter, improvement,
    letterEdited, aiFailures, needsTeacherReview: aiFailures.length > 0,
    checklist, fixTask, stars, level,
    flags: flags.map((code) => ({ code, label: ERROR_LABELS[code] || code })),
  });
}

export function scoreOwnContentByKeyword(text, keywordGroups, max) {
  if (!keywordGroups || !keywordGroups.length) return text.trim().length > 10 ? Math.round(max * 0.53) : 0;
  const lower = text.toLowerCase();
  const hitGroups = keywordGroups.filter((group) => group.some((kw) => lower.includes(kw.toLowerCase())));
  const ratio = hitGroups.length / keywordGroups.length;
  return Math.round(Math.min(1, ratio + (text.trim().length > 15 ? 0.15 : 0)) * max);
}

/** Step 1 marking. Purpose/Audience/Context chunks must be tagged with their
 * own type; "other" (Not needed) chunks only count if the pupil tagged them;
 * "optional" chunks are ignored completely. Score is the fraction correct. */
export function scoreTaskIdentification(taskChunks, taskAnswers, weight) {
  const answers = taskAnswers || {};
  let counted = 0, correct = 0;
  for (const chunk of taskChunks || []) {
    const type = chunk && chunk.type;
    const given = answers[chunk && chunk.id];
    if (type === "optional") continue;
    if (type === "other") { if (!given) continue; }
    else if (type !== "purpose" && type !== "audience" && type !== "context") continue;
    counted++;
    if (given === type) correct++;
  }
  const ratio = counted ? correct / counted : 1;
  return { score: Math.round(ratio * weight), max: weight, correct, counted };
}

/** v1.12: any non-blank name is fine — no last name required. */
export function validateSignOffName(raw, format) {
  const name = (raw || "").toString().trim().slice(0, 60);
  if (normaliseFormat(format) === "article") {
    // v1.15: the byline must be non-blank. The FULL-name rule (first + last) is enforced by the
    // marking (byline-first-name flag, checklist, fix-it card, lower content score), not by a
    // hard error, so a pupil who picks the "first name only" wrong option still gets marked and learns.
    if (!name) return { ok: false, error: "Please choose or type your byline (your first and last name, e.g. By Wei Ming Tan)." };
    return { ok: true, name };
  }
  if (!name) return { ok: false, error: "Please choose or type a name to sign off with. A first name is enough." };
  return { ok: true, name };
}

/** Which AI-marked criteria silently fell back to a keyword/similarity
 * estimate because the AI marker was needed but gave no usable answer. */
export function detectAiFailures({ ownNeedsAi, ownAiResult, holisticNeedsAi, holisticAiResult }) {
  const out = [];
  if (ownNeedsAi && !ownAiResult) out.push({ part: "ownContent", label: "Your hunch (own idea)", reason: "The AI examiner was unavailable, so a rule-based estimate was used." });
  if (holisticNeedsAi && !holisticAiResult) out.push({ part: "overallQuality", label: "Language & organisation", reason: "The AI examiner was unavailable, so a rule-based estimate was used." });
  return out;
}

/** Validates a teacher's fresh scores against the automatic breakdown and
 * returns the new breakdown + total. Each criterion is capped at its max. */
export function applyTeacherScores(autoBreakdown, scores) {
  const out = {};
  let total = 0, max = 0;
  for (const key of Object.keys(autoBreakdown || {})) {
    const auto = autoBreakdown[key];
    if (!auto || typeof auto.max !== "number") continue;
    let v = scores && scores[key] !== undefined && scores[key] !== "" ? Number(scores[key]) : auto.score;
    if (!Number.isFinite(v)) return { error: `Score for ${key} must be a number.` };
    v = Math.round(v);
    if (v < 0 || v > auto.max) return { error: `Score for ${key} must be between 0 and ${auto.max}.` };
    out[key] = { ...auto, score: v, teacherScored: v !== auto.score };
    delete out[key].aiFailed; // a teacher has now looked at it
    total += v; max += auto.max;
  }
  if (!Object.keys(out).length) return { error: "Nothing to grade." };
  return { breakdown: out, total, max };
}

export function assembleLetter(full, componentChoices, paragraphBreaksSet, signOffName, componentResponses = {}) {
  const article = isArticleFormat(full);
  let out = "";
  let prevKey = "";
  for (const comp of full.components) {
    const chosenId = componentChoices[comp.key];
    const opt = comp.options.find((o) => o.id === chosenId);
    const text = chosenId === "custom" ? String(componentResponses[comp.key] || "").trim() : (opt ? opt.text : "");
    if (!text) continue;
    if (out.length) {
      if (paragraphBreaksSet.has(comp.key)) out += "\n\n";
      // v1.14: a real letter keeps the salutation, sign-off and name on their own lines.
      else if (article
        ? (prevKey === "headline" || prevKey === "byline" || comp.key === "byline")
        : (prevKey === "salutation" || comp.key === "signoff" || comp.key === "name")) out += "\n";
      else out += " ";
    }
    out += text;
    prevKey = comp.key;
  }
  // The 13th part ("Name") is itself a component, so its text is usually
  // already at the end — only add the sign-off name if it isn't there yet.
  // (An article's byline is itself a component and can sit under the headline, so it is never re-appended.)
  if (!article && signOffName && !out.trim().endsWith(signOffName)) out += (out.length ? "\n" : "") + signOffName;
  return out.trim();
}

export function jaccardSimilarity(a, b) {
  const tok = (s) => new Set(s.toLowerCase().match(/[a-z']+/g) || []);
  const A = tok(a), B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

