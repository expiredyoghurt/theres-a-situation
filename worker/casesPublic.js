// v2.0 — extracted from the v1.x single-file worker without behaviour changes.
import { normaliseFormat } from "./marking.js";
import { DEMO_CASES } from "./demoCases.js";
import { validateCaseRow } from "./validate.js";
import { json } from "./common.js";
import { findPlayableCase, toPublicCase } from "./overview.js";

// ---------- student access / case listing ----------

export async function ensureSettingsTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
}

/** Shared read for a boolean app_settings flag. Fails open (returns
 * `defaultValue`) if the settings table isn't migrated yet, matching the
 * existing student-access behavior — a missing table should never
 * accidentally lock pupils out. */
export async function isAppSettingEnabled(env, key, defaultValue) {
  try {
    await ensureSettingsTable(env);
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first();
    return row ? row.value !== "0" : defaultValue;
  } catch (e) { return defaultValue; }
}

export async function setAppSettingEnabled(env, key, enabled) {
  await ensureSettingsTable(env);
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, enabled ? "1" : "0").run();
}

export async function isStudentAccessEnabled(env) {
  return isAppSettingEnabled(env, "student_access_enabled", true);
}

export async function getStudentAccessSetting(env) { return json({ enabled: await isStudentAccessEnabled(env) }); }

export async function setStudentAccessSetting(env, request, session) {
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
export async function isTutorialCasesEnabled(env) {
  return isAppSettingEnabled(env, "tutorial_cases_enabled", true);
}

export async function getTutorialAccessSetting(env) { return json({ enabled: await isTutorialCasesEnabled(env) }); }

export async function setTutorialAccessSetting(env, request, session) {
  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
  try {
    await setAppSettingEnabled(env, "tutorial_cases_enabled", body.enabled);
    return json({ enabled: body.enabled, changedBy: session.username });
  } catch (e) { return json({ error: "Could not save tutorial access setting. Run schema.sql against the D1 database." }, 500); }
}

// ---------- case listing / retrieval ----------

export async function listCases(env) {
  if (!(await isStudentAccessEnabled(env))) return json({ cases: [], studentAccessEnabled: false });
  const tutorialCasesEnabled = await isTutorialCasesEnabled(env);
  const demoList = tutorialCasesEnabled
    ? DEMO_CASES.map((c) => ({ id: c.id, title: c.title, formal: c.formal, format: normaliseFormat(c), imageData: c.imageData, builtin: true }))
    : [];
  let dbList = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM cases WHERE status = 'published' ORDER BY created_at DESC"
    ).all();
    dbList = (results || []).filter((r) => validateCaseRow(r).ok).map((r) => ({
      id: r.id, title: r.title, formal: !!r.formal, format: normaliseFormat(r), imageUrl: r.image_data ? `/api/cases/${r.id}/image` : null, builtin: false,
    }));
  } catch (e) { /* DB might not be migrated yet — demo cases still work */ }
  return json({ cases: [...demoList, ...dbList], tutorialCasesEnabled });
}

/** A demo/tutorial case id (see demoCases.js) is only playable while the
 * tutorial-cases toggle is on. Teacher-uploaded cases are never affected
 * by this check. */
export async function isBlockedTutorialCase(env, id) {
  return DEMO_CASES.some((c) => c.id === id) && !(await isTutorialCasesEnabled(env));
}

export async function getCase(env, id) {
  if (!(await isStudentAccessEnabled(env))) return json({ error: "Student access is currently disabled." }, 403);
  if (await isBlockedTutorialCase(env, id)) return json({ error: "Tutorial cases are currently disabled." }, 403);
  const full = await findPlayableCase(env, id);
  if (!full) return json({ error: "Case not found" }, 404);
  return json({ case: toPublicCase(full) });
}

