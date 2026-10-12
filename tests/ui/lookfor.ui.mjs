// Browser test: Step 2 "What to look for" checklist (pupil) and its editor (teacher).
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { openAdmin } from "./admin_mock.mjs";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox"] });
const errs = [];
for (const vw of [{ width: 1100, height: 900 }, { width: 390, height: 800 }]) {
  const p = await b.newPage({ viewport: vw });
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8791/"); await p.fill("#launchInput", "Mei@5IG"); await p.click("#launchGo");
  await p.click('.case-card[data-id="demo-1"]'); await p.waitForFunction(() => state.currentCase);
  await p.evaluate(() => { state.step = 1; render(); });
  await p.waitForSelector(".lookfor");
  const n = await p.locator(".lookfor input[data-lf]").count();
  assert.equal(n, await p.evaluate(() => state.currentCase.lookFor.length));
  assert.match(await p.innerText(".lf-count"), new RegExp(`0 of ${n} found`));
  await p.locator(".lookfor input[data-lf]").nth(0).check();
  await p.locator(".lookfor input[data-lf]").nth(1).check();
  assert.match(await p.innerText(".lf-count"), new RegExp(`2 of ${n} found`));
  // pinning a tile re-renders the step: ticks must survive
  await p.locator(".evidence-card").first().click();
  assert.equal(await p.locator(".lookfor input[data-lf]:checked").count(), 2, "ticks survive re-render");
  for (let i = 2; i < n; i++) await p.locator(".lookfor input[data-lf]").nth(i).check();
  assert.ok(await p.evaluate(() => document.querySelector(".lookfor").classList.contains("all")), "all-found style");
  // the answer values never appear in the checklist
  const txt = await p.innerText(".lookfor");
  for (const leak of ["14 March", "School Hall", "Kumar", "9am"]) assert.ok(!txt.includes(leak), "leak: " + leak);
  // no checklist => no panel
  await p.evaluate(() => { state.currentCase.lookFor = []; render(); });
  assert.equal(await p.locator(".lookfor").count(), 0, "hidden when the teacher gave none");
  await p.close();
}
// teacher editor
{
  const { p, errs: aerrs } = await openAdmin(b, { width: 1100, height: 900 });
  await p.click('button[data-action="edit-toggle"]');
  await p.click('details[data-step="2"] > summary');
  await p.waitForSelector("[data-lookfor]");
  assert.equal(await p.inputValue("[data-lookfor]"), "The date\nThe place");
  await p.fill("[data-lookfor]", "");
  await p.click("[data-lookfor-suggest]");
  await p.waitForFunction(() => document.querySelector("[data-lookfor]").value.includes("The date"));
  assert.match(await p.innerText("[data-lookfor-status]"), /Suggested/);
  assert.deepEqual(aerrs.filter((e) => !/taskIdentification/.test(e)), []);
  await p.close();
}
await b.close();
assert.deepEqual(errs, []);
console.log("lookfor ui ok");
