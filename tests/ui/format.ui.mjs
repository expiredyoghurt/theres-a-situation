// Browser test: teacher "Writing format" control at the top of Step 1 in the case editor.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { openAdmin } from "./admin_mock.mjs";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox"] });
for (const vw of [{ width: 1100, height: 900 }, { width: 390, height: 800 }]) {
  const { p, errs } = await openAdmin(b, vw);
  globalThis.__fmtCalls = [];
  await p.click('button[data-action="edit-toggle"]');   // first case = informal letter, published
  await p.click('details[data-step="1"] > summary');
  await p.waitForSelector("[data-fmt]");
  assert.equal(await p.locator("[data-fmt] input[type=radio]").count(), 3);
  assert.equal(await p.locator("[data-fmt] input[type=radio]:checked").getAttribute("value"), "informal_letter");
  assert.ok(await p.locator("[data-fmt-go]").isDisabled(), "disabled when unchanged");
  assert.ok(!(await p.locator("[data-fmt-register]").isVisible()));
  // letter -> letter shows the rebuild checkbox
  await p.check('[data-fmt] input[value="formal_letter"]');
  assert.ok(await p.locator("[data-fmt-register]").isVisible());
  // letter -> article hides it and shows the warning
  await p.check('[data-fmt] input[value="article"]');
  assert.ok(!(await p.locator("[data-fmt-register]").isVisible()));
  assert.match(await p.innerText("[data-fmt-note]"), /model answer is NOT rewritten/);
  // declining the confirm sends nothing
  p.once("dialog", (d) => d.dismiss());
  await p.click("[data-fmt-go]");
  assert.equal(globalThis.__fmtCalls.length, 0);
  p.once("dialog", (d) => d.accept());
  await p.click("[data-fmt-go]");
  await p.waitForFunction(() => document.querySelector(".msg"));
  const banner = await p.innerText(".msg");
  assert.match(banner, /article/); assert.match(banner, /could not build/); assert.match(banner, /model answer was not changed/);
  assert.equal(globalThis.__fmtCalls.length, 1);
  assert.equal(globalThis.__fmtCalls[0].format, "article");
  assert.deepEqual(errs.filter((e) => !/taskIdentification/.test(e)), []);
  await p.close();
}
await b.close();
console.log("format ui ok");
