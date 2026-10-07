// v1.16 — structural validation for a raw `cases` row.
// Pure and non-throwing. Used on Publish, in the admin case list (so a bad SQL
// import shows a checklist instead of breaking the page) and to hide broken
// cases from pupils.
import { normaliseFormat } from "./marking.js";

export const LETTER_KEYS = ["salutation", "greeting", "purpose", "context", "keyinfo1", "keyinfo2", "keyinfo3", "keyinfo4", "keyinfo5", "ownIdea", "closing", "signoff", "name"];
export const ARTICLE_KEYS = ["headline", "byline", "hook", "purpose", "context", "keyinfo1", "keyinfo2", "keyinfo3", "keyinfo4", "keyinfo5", "ownIdea", "cta", "thanks"];
export const IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
export const MAX_IMAGE_LEN = 760000;

function parse(raw, label, errors) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch (e) { errors.push(`${label} is not valid JSON.`); return undefined; }
}

export function validateCaseRow(row) {
  const errors = [], warnings = [];
  if (!row || typeof row !== "object") return { ok: false, errors: ["Case row is missing."], warnings };
  if (!/^[a-zA-Z0-9_-]+$/.test(String(row.id || ""))) errors.push("Case id must use letters, numbers, _ and - only.");
  if (!String(row.title || "").trim()) errors.push("Title is empty.");
  if (!String(row.task_text || "").trim()) errors.push("Task text is empty.");
  const format = normaliseFormat(row);
  const keys = format === "article" ? ARTICLE_KEYS : LETTER_KEYS;

  const chunks = parse(row.task_chunks, "task_chunks", errors);
  if (chunks !== undefined && (!Array.isArray(chunks) || !chunks.length || chunks.some((c) => !c || !String(c.text || "").trim()))) errors.push("task_chunks needs at least one chunk with text.");

  const stim = parse(row.stimulus_points, "stimulus_points", errors);
  if (stim !== undefined) {
    if (!Array.isArray(stim) || !stim.length) errors.push("stimulus_points is empty.");
    else {
      if (stim.some((p) => !p || !p.id || !String(p.text || "").trim())) errors.push("Every stimulus point needs an id and text.");
      if (!stim.some((p) => p && p.relevant === true)) errors.push("No stimulus point is marked relevant:true.");
    }
  }

  if (row.own_content_keywords != null && row.own_content_keywords !== "") {
    const kw = parse(row.own_content_keywords, "own_content_keywords", errors);
    if (kw !== undefined && !Array.isArray(kw)) errors.push("own_content_keywords must be a JSON array.");
  }

  const comps = parse(row.components, "components", errors);
  const ak = parse(row.answer_key, "answer_key", errors);
  if (comps !== undefined) {
    if (!Array.isArray(comps)) errors.push("components must be a JSON array.");
    else {
      const got = comps.map((c) => c && c.key);
      if (JSON.stringify(got) !== JSON.stringify(keys)) {
        const other = format === "article" ? LETTER_KEYS : ARTICLE_KEYS;
        errors.push(JSON.stringify(got) === JSON.stringify(other)
          ? `format is '${format}' but the components are the ${format === "article" ? "letter" : "article"} parts. Fix the format column.`
          : `components must be exactly these 13 keys in order for ${format}: ${keys.join(", ")}.`);
      } else {
        for (const c of comps) {
          const ids = (c.options || []).map((o) => o && o.id).join(",");
          if (ids !== "a,b,c") errors.push(`"${c.key}" needs exactly 3 options with ids a, b, c.`);
          else if (c.options.some((o) => !String(o.text || "").trim())) errors.push(`"${c.key}" has a blank option.`);
          else if (new Set(c.options.map((o) => String(o.text).trim().toLowerCase())).size < 3) warnings.push(`"${c.key}" has duplicate option text.`);
        }
        if (ak !== undefined) {
          for (const c of comps) {
            const id = ak && ak.components && ak.components[c.key];
            if (!id || !(c.options || []).some((o) => o.id === id)) errors.push(`answer_key has no valid correct option for "${c.key}".`);
          }
          const pb = ak && ak.paragraphBreaks;
          if (!Array.isArray(pb) || !pb.length) warnings.push("answer_key.paragraphBreaks is missing; paragraph marking will use defaults.");
          else if (pb.some((k) => !keys.includes(k))) errors.push("answer_key.paragraphBreaks contains an unknown part key.");
        }
      }
    }
  }

  if (row.image_data) {
    if (!IMAGE_RE.test(String(row.image_data))) errors.push("image_data is not a PNG/JPEG/WebP/GIF base64 data URI.");
    else if (String(row.image_data).length > MAX_IMAGE_LEN) errors.push("image_data is over 500 KB.");
  } else warnings.push("No stimulus picture attached yet.");
  if (!String(row.model_letter || "").trim()) warnings.push("No model answer.");
  return { ok: errors.length === 0, errors, warnings };
}
