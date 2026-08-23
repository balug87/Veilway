#!/usr/bin/env node
import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8080/";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
await page.getByTestId("start-drive").click();
const ok = await page
  .waitForFunction(() => Boolean(window.__controlsTest), { timeout: 28000 })
  .then(() => true)
  .catch(() => false);
const body = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/veilway-osm.png" });
console.log(JSON.stringify({ ok, errors, snippet: body.slice(0, 240) }, null, 2));
await browser.close();
if (!ok) process.exit(2);
