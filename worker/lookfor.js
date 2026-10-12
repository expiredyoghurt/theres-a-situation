// v2.2 — Step 2 "what to look for" checklist.
// Labels name the KIND of information to find (never the value), so they guide pupils
// without giving away which tiles are correct.
export const MAX_LOOK_FOR = 8;
export const MAX_LOOK_FOR_LEN = 80;

/** Teacher input (array, or text with one label per line) -> clean, de-duplicated list. */
export function cleanLookFor(input) {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(/\r?\n/) : [];
  const out = [], seen = new Set();
  for (const r of raw) {
    const t = String(r ?? "").replace(/^[\s\-•*\d.)]+/, "").trim().slice(0, MAX_LOOK_FOR_LEN);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= MAX_LOOK_FOR) break;
  }
  return out;
}

/** Stored column (JSON text or array) -> list. Never throws. */
export function parseLookFor(v) {
  if (Array.isArray(v)) return cleanLookFor(v);
  if (typeof v !== "string" || !v.trim()) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? cleanLookFor(a) : []; } catch (e) { return []; }
}

const RULES = [
  [/\b(by|before|deadline|no later than|register|registration|sign\s?-?up|rsvp|reply)\b/i, "The sign-up or reply deadline"],
  [/\b(\d{1,2}\s?[:.]\s?\d{2}|\d{1,2}\s?(a\.?m\.?|p\.?m\.?)|noon|midnight|o'clock)\b/i, "The time"],
  [/\b(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?\b|\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b|\b\d{1,2}(st|nd|rd|th)\b/i, "The date"],
  [/\b(venue|location|where|hall|room|field|library|canteen|court|garden|rooftop|level\s?\d|block|classroom|auditorium|gym|centre|center|park)\b/i, "The place"],
  [/\b(cost|fee|price|free of charge|\$\s?\d|dollars?|pay|payment)\b/i, "The cost"],
  [/\b(contact|call|email|phone|ask|see|with (mr|mrs|ms|miss|mdm|dr)\b|(mr|mrs|ms|miss|mdm)\s+[A-Z])/i, "Who to contact or sign up with"],
  [/\b(bring|wear|dress|pack|carry|prepare|attire|uniform)\b/i, "What to bring or wear"],
];

/** Deterministic suggestion from the correct key-information texts (one label per text, de-duplicated). */
export function suggestLookFor(texts) {
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t || "").trim()).filter(Boolean);
  const labels = [];
  let other = 0;
  for (const t of list) {
    // A tile such as "Date: Saturday, 14 March, 9am to 12pm" holds a date AND a time: offer both prompts.
    const hits = RULES.filter(([re]) => re.test(t)).map(([, l]) => l);
    const picked = hits.includes("The date") && hits.includes("The time") ? ["The date", "The time"] : hits.slice(0, 1);
    if (!picked.length) picked.push(other++ === 0 ? "What happens at the event" : "Another important detail");
    for (const l of picked) if (!labels.includes(l)) labels.push(l);
  }
  return labels.slice(0, MAX_LOOK_FOR);
}
