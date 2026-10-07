// Browser smoke test for Step 4 (stepper + format preview). Needs playwright + chromium.
//   node tests/ui/serve.mjs "$PWD" 8791 &   then   node tests/ui/step4.ui.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox"] });
const errs = [];
for (const [vw, id, cls] of [[{ width: 1100, height: 900 }, "demo-3", "paper-news"], [{ width: 390, height: 800 }, "demo-1", "paper-letter"]]) {
  const p = await b.newPage({ viewport: vw });
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8791/");
  await p.fill("#launchInput", "Mei@5IG"); await p.click("#launchGo");
  await p.click(`.case-card[data-id="${id}"]`);
  await p.waitForFunction(() => state.currentCase);
  await p.evaluate(() => { state.step = 3; state.level = 1; render(); });
  await p.waitForSelector("#components .component.active");
  assert.equal(await p.locator("#components .component:visible").count(), 1, "one part at a time");
  for (let i = 0; i < 13; i++) await p.locator("#components .component.active .option").first().click();
  assert.match(await p.innerText("#progressSticky"), /13 of 13/);
  assert.ok(await p.locator(`#preview.${cls}`).count(), "format-specific preview");
  await p.click('.part-dot[data-k="4"]');
  await p.fill("#components .component.active textarea", "My own key sentence.");
  assert.ok((await p.innerText("#preview")).includes("My own key sentence."));
  await p.close();
}
await b.close();
assert.deepEqual(errs, []);
console.log("step4 ui ok");
