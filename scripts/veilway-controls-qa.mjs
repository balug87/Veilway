#!/usr/bin/env node
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const browser = await chromium.launch({ args: ["--use-gl=angle", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("CONSOLE", msg.type(), msg.text());
});
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));

await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
await page.getByTestId("practice").click();
await page.waitForFunction(() => Boolean(window.__controlsTest), { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: "/workspace/screenshots/veilway-play.png" });

await page.evaluate(() => {
  window.__controlsTest?.setKeys?.(["KeyW"]);
  if (window.__controlsTest?.setSteer) window.__controlsTest.setSteer(0);
});
await page.waitForFunction(() => (window.__controlsTest?.getSpeed() ?? 0) > 2.5, { timeout: 8000 });

const y0 = await page.evaluate(() => window.__controlsTest.getYaw());
await page.evaluate(() => window.__controlsTest.setSteer(1));
await page.waitForTimeout(550);
const yA = await page.evaluate(() => window.__controlsTest.getYaw());
await page.evaluate(() => window.__controlsTest.setSteer(0));
await page.waitForTimeout(80);
await page.evaluate(() => window.__controlsTest.setSteer(-1));
await page.waitForTimeout(550);
const yD = await page.evaluate(() => window.__controlsTest.getYaw());
const speed = await page.evaluate(() => window.__controlsTest.getSpeed());

const dA = wrap(yA - y0);
const dD = wrap(yD - yA);
const ok = dA > 0.05 && dD < -0.05 && speed > 1;
console.log(JSON.stringify({ y0, yA, yD, dA, dD, speed, ok }, null, 2));

await page.keyboard.up("KeyW");
await page.screenshot({ path: "/workspace/screenshots/veilway-driving.png" });
await browser.close();
if (!ok) process.exit(1);
