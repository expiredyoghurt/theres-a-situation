// Browser test: Case file pop-up (all three Step 4 modes), gauge fill animation and the CASE CLOSED stamp.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox"] });
const errs = [];
async function openCase(p, id) {
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8791/");
  await p.fill("#launchInput", "Mei@5IG"); await p.click("#launchGo");
  await p.click(`.case-card[data-id="${id}"]`);
  await p.waitForFunction(() => state.currentCase);
}
async function checkPopup(p, label, vw) {
  const task = await p.evaluate(() => state.currentCase.taskText);
  await p.waitForSelector("[data-casefile]");
  await p.click("[data-casefile]");
  assert.ok(await p.evaluate(() => document.getElementById("caseFileDialog").open), label + ": opens");
  const txt = await p.innerText("#caseFileDialog");
  assert.ok(txt.replace(/\s+/g, " ").includes(task.replace(/\s+/g, " ").slice(0, 40)), label + ": shows the task");
  assert.ok(await p.locator("#caseFileDialog img.cf-pic").count() >= 1, label + ": shows the picture");
  const box = await p.locator("#caseFileDialog").boundingBox();
  assert.ok(box.y >= 0 && box.y + box.height <= vw.height + 1, label + ": fits the screen");
  await p.keyboard.press("Escape");
  assert.ok(!(await p.evaluate(() => document.getElementById("caseFileDialog").open)), label + ": Esc closes");
  assert.ok(await p.evaluate(() => document.activeElement && document.activeElement.hasAttribute("data-casefile")), label + ": focus returns to the button");
  await p.click("[data-casefile]"); await p.click("[data-cfclose]");
  assert.ok(!(await p.evaluate(() => document.getElementById("caseFileDialog").open)), label + ": Close button closes");
}
for (const [tag, vw] of [["desktop", { width: 1100, height: 900 }], ["phone", { width: 390, height: 800 }]]) {
  // Level 1 guided, then confirmed-edit
  let p = await b.newPage({ viewport: vw }); await openCase(p, "demo-3");
  await p.evaluate(() => { state.step = 3; state.level = 1; render(); });
  await p.waitForSelector("#components .component.active");
  await p.click('.part-dot[data-k="4"]');
  await p.fill("#components .component.active textarea", "Typed before opening.");
  await checkPopup(p, tag + " guided", vw);
  assert.equal(await p.inputValue("#components .component.active textarea"), "Typed before opening.", tag + ": typed text survives");
  for (let i = 0; i < 13; i++) { await p.click(`.part-dot[data-k="${i}"]`); if (i !== 4) await p.locator("#components .component.active .option").first().click(); }
  await p.click("#confirmLetter"); await p.waitForSelector("#finalLetter");
  await p.fill("#finalLetter", "My edited article text.");
  await checkPopup(p, tag + " confirmed", vw);
  assert.equal(await p.inputValue("#finalLetter"), "My edited article text.", tag + ": edit survives");
  await p.close();
  // Level 3 independent
  p = await b.newPage({ viewport: vw }); await openCase(p, "demo-1");
  await p.evaluate(() => { state.step = 3; state.level = 3; render(); });
  await p.waitForSelector("#finalLetter");
  await checkPopup(p, tag + " independent", vw);
  await p.close();
}
// Gauges fill after render (not stuck empty) and the stamp shows only on a pass.
for (const reduced of [false, true]) {
  const ctx = await b.newContext({ viewport: { width: 900, height: 900 }, reducedMotion: reduced ? "reduce" : "no-preference" });
  const p = await ctx.newPage(); await openCase(p, "demo-3");
  await p.evaluate(() => { for (const ch of state.currentCase.taskChunks) state.taskAnswers[ch.id] = "other"; state.step = 3; state.level = 1; render(); });
  await p.waitForSelector("#components .component.active");
  for (let i = 0; i < 13; i++) await p.locator("#components .component.active .option").first().click();
  await p.click("#confirmLetter"); await p.waitForSelector("#finalLetter");
  await p.click("#navNext"); await p.waitForSelector(".gauge");
  await p.waitForFunction(() => [...document.querySelectorAll(".gfill")].every((e) => e.getAttribute("stroke-dashoffset") === e.dataset.off), null, { timeout: 3000 });
  assert.equal(await p.locator(".case-closed").count(), 0, "no stamp on a fail");
  await p.evaluate(() => { state.result.passed = true; state.result.score = state.result.max; render(); });
  await p.waitForSelector(".gauge");
  if (await p.locator(".case-closed").count() === 0) { // `passed` may be derived from score vs threshold
    await p.evaluate(() => { state.result.score = state.result.max; render(); });
  }
  assert.equal(await p.locator(".case-closed").count(), 1, "stamp on a pass");
  assert.equal(await p.getAttribute(".case-closed", "aria-hidden"), "true");
  const anim = await p.evaluate(() => getComputedStyle(document.querySelector(".case-closed")).animationName);
  assert.equal(anim === "none", reduced, `stamp animation ${reduced ? "off" : "on"} (reduced-motion=${reduced}), got ${anim}`);
  await ctx.close();
}
await b.close();
assert.deepEqual(errs, []);
console.log("casefile ui ok");
