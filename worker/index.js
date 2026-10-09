/**
 * Boss! There's a situation! — Worker
 * Version: v1.15
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

import { adminCreateCase, adminCreateManualCase, adminDeleteCase, adminListCases, adminPublishCase, adminSaveCaseBriefing, adminSaveCaseComponents, adminSaveCaseEvidence, adminSaveCaseHint, adminUpdateCaseImage } from "./adminCases.js";
import { adminAiHealth, adminGetSubmission, adminGradeSubmission, adminListSubmissions, adminRegenerateCasePart } from "./adminSubmissions.js";
import { adminCreateTeacher, adminDeleteTeacher, adminListTeachers, adminLogin, adminMe, adminUpdateTeacher, changePassword, getRubric, requireAuth, saveRubricRoute } from "./auth.js";
import { getCase, getStudentAccessSetting, getTutorialAccessSetting, listCases, setStudentAccessSetting, setTutorialAccessSetting } from "./casesPublic.js";
import { json } from "./common.js";
import { APP_VERSION } from "./config.js";
import { fixCheck, getConfig, getLeaderboard, getLevelsAccessSetting, getMyScores, getPracticeDue, setLevelsAccessSetting } from "./leaderboard.js";
import { adminLetterErrors, adminListClasses, adminMisconceptions, adminOverview, getCaseImage } from "./overview.js";
import { ensureSchema } from "./schema.js";
import { submitCase } from "./scoring.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.startsWith("/api/")) await ensureSchema(env);
      // ---------- pupil-facing ----------
      if (path === "/api/cases" && request.method === "GET") {
        return await listCases(env);
      }
      const imgMatch = path.match(/^\/api\/cases\/([a-zA-Z0-9_-]+)\/image$/);
      if (imgMatch && request.method === "GET") return await getCaseImage(env, imgMatch[1]);
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
      if (path === "/api/config" && request.method === "GET") {
        return await getConfig(env);
      }
      const fixMatch = path.match(/^\/api\/cases\/([a-zA-Z0-9_-]+)\/fix-check$/);
      if (fixMatch && request.method === "POST") {
        return await fixCheck(env, request, fixMatch[1]);
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
        return await requireAuth(env, request, (session) => adminPublishCase(env, publishMatch[1], session, url.searchParams.get("force") === "1"));
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
      const briefingMatch = path.match(/^\/api\/admin\/cases\/([a-zA-Z0-9_-]+)\/briefing$/);
      if (briefingMatch && request.method === "PUT") {
        return await requireAuth(env, request, (session) => adminSaveCaseBriefing(env, request, briefingMatch[1], session));
      }
      const evidenceMatch = path.match(/^\/api\/admin\/cases\/([a-zA-Z0-9_-]+)\/evidence$/);
      if (evidenceMatch && request.method === "PUT") {
        return await requireAuth(env, request, (session) => adminSaveCaseEvidence(env, request, evidenceMatch[1], session));
      }
      const hintMatch = path.match(/^\/api\/admin\/cases\/([a-zA-Z0-9_-]+)\/hint$/);
      if (hintMatch && request.method === "PUT") {
        return await requireAuth(env, request, (session) => adminSaveCaseHint(env, request, hintMatch[1], session));
      }
      const delMatch = path.match(/^\/api\/admin\/cases\/([a-zA-Z0-9_-]+)$/);
      if (delMatch && request.method === "DELETE") {
        return await requireAuth(env, request, () => adminDeleteCase(env, delMatch[1]));
      }

      // ---------- submissions: review + teacher grade override ----------
      if (path === "/api/admin/submissions" && request.method === "GET") {
        return await requireAuth(env, request, (session) => adminListSubmissions(env, session, url));
      }
      const subGradeMatch = path.match(/^\/api\/admin\/submissions\/(\d+)\/grade$/);
      if (subGradeMatch && request.method === "PUT") {
        return await requireAuth(env, request, (session) => adminGradeSubmission(env, request, session, Number(subGradeMatch[1])));
      }
      const subMatch = path.match(/^\/api\/admin\/submissions\/(\d+)$/);
      if (subMatch && request.method === "GET") {
        return await requireAuth(env, request, (session) => adminGetSubmission(env, session, Number(subMatch[1])));
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
      if (path === "/api/admin/levels-access" && request.method === "GET") {
        return await requireAuth(env, request, () => getLevelsAccessSetting(env));
      }
      if (path === "/api/admin/levels-access" && request.method === "PUT") {
        return await requireAuth(env, request, (session) => setLevelsAccessSetting(env, request, session));
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
      if (path === "/api/admin/letter-errors" && request.method === "GET") {
        return await requireAuth(env, request, (session) => adminLetterErrors(env, session, url));
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


// Named exports for local testing (see tests/).
export { APP_VERSION } from "./config.js";
export { normaliseTaskChunks, buildStimulusPointsFromTiles, parseBuildFlags, buildFlagsJsonWithout } from "./adminCases.js";
export { buildOptionComponent, fallbackTaskChunks, fallbackSalutationSet, fallbackSignoffSet, fallbackPurposeSet, fallbackFillerSet, fallbackKeyInfoDistractors, buildManualCaseFromComponents } from "./adminSubmissions.js";
export { isFreeOpenRouterModel } from "./ai.js";
export { getMyScores, getLeaderboard, fixCheck } from "./leaderboard.js";
export { adminOverview, adminLetterErrors } from "./overview.js";
export { scoreOwnContentByKeyword, jaccardSimilarity, assembleLetter, scoreTaskIdentification, validateSignOffName, detectAiFailures, applyTeacherScores, remapChoices, submitCase } from "./scoring.js";
