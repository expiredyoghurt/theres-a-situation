import { chromium } from "playwright";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const mkCase = (id, title, format, status, img, ok = true) => ({ id, title, format, formal: format === "formal_letter", status, imageData: img, taskText: "Task text", taskChunks: [{ id: "t1", text: "x", type: "purpose" }], stimulusPoints: [{ id: "s1", text: "p", relevant: true }], components: [], answerKey: { components: {}, paragraphBreaks: [] }, ownContentKeywords: [], buildFlags: { failedParts: [] }, created_by: "jeremy", validation: ok ? { ok: true, errors: [], warnings: img ? [] : ["No stimulus picture attached yet."] } : { ok: false, errors: ["components must be exactly these 13 keys"], warnings: [] } });
export async function openAdmin(browser, vw) {
  const p = await browser.newPage({ viewport: vw });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**/api/admin/**", (r) => {
    const u = new URL(r.request().url()).pathname;
    const j = (o) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
    if (u === "/api/admin/cases") return j({ cases: [mkCase("c1", "The School Clean-Up Day", "informal_letter", "published", png), mkCase("c2", "Garden Club Open House", "article", "draft", null), mkCase("c3", "Bad Import", "formal_letter", "draft", png, false)] });
    return j({ ok: true, enabled: true, tutorialCasesEnabled: true, rubric: {}, submissions: [], classes: [], pupils: [], cases: [], misconceptions: [], teachers: [], providers: [] });
  });
  await p.addInitScript(() => { sessionStorage.setItem("adminToken", "t"); sessionStorage.setItem("adminMe", JSON.stringify({ username: "jeremy", role: "admin", classes: [] })); });
  await p.goto("http://localhost:8791/admin.html"); await p.waitForTimeout(1000);
  return { p, errs };
}
