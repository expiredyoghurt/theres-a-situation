// Browser smoke test for the teacher page tabs and case cards (API is mocked in admin_mock.mjs).
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { openAdmin } from "./admin_mock.mjs";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox"] });
for (const vw of [{ width: 1100, height: 900 }, { width: 390, height: 800 }]) {
  const { p, errs } = await openAdmin(b, vw);
  const vis = () => p.evaluate(() => [...document.querySelectorAll(".tabpane")].filter((e) => !e.hidden).map((e) => e.id));
  assert.deepEqual(await vis(), ["tab-cases"]);
  assert.equal(await p.locator(".case-row").count(), 3);
  assert.equal(await p.locator(".vchip.bad").count(), 1, "invalid case flagged");
  assert.equal(await p.locator('button[data-action="publish"]').count(), 1, "only the valid draft can be published");
  for (const t of ["results", "settings", "backend"]) { await p.click(`[data-tab="${t}"]`); assert.deepEqual(await vis(), ["tab-" + t]); }
  await p.reload(); await p.waitForTimeout(600);
  assert.deepEqual(await vis(), ["tab-backend"], "last tab is remembered");
  assert.deepEqual(errs.filter((e) => !/taskIdentification/.test(e)), []);
  await p.close();
}
await b.close(); console.log("admin ui ok");
