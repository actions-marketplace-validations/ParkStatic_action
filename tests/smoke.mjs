#!/usr/bin/env node
// Functional smoke test for a PACKAGED build. Where the action's own prerender
// step captures HTML, this step answers a different question: does the final
// artifact we are about to ship actually render in a real browser? It serves
// the exact output directory (the files that go into dist.zip) with the same
// SPA-fallback static server the Parkstatic WP plugin emulates, loads it in
// headless Chromium, and fails on the failure modes that cause a "blank page":
//
//   - uncaught runtime / hydration errors (React unmount to blank, $_TSR
//     invariant, etc.)
//   - assets that 404 or fail to load (broken /assets/ references)
//   - an empty rendered body (nothing painted at all)
//   - expected content missing after hydration (wrong or crashed render)
//
// No deployment, no screenshots — just the browser we already ship for
// prerendering. Deterministic because it runs against our own fixtures.
//
// Usage:  node tests/smoke.mjs <path> [requiredMarker ...]
// Env:    SMOKE_OUTPUT_DIR  required, directory to serve (the build output)
//         SMOKE_WAIT        optional, Playwright waitUntil (default networkidle)
//         SMOKE_TIMEOUT_MS  optional, per-navigation timeout (default 15000)
//         DEBUG             optional, "true" for verbose logging

import { chromium } from "playwright";
import { startStaticServer, ensureStaticOutput } from "../scripts/serve-static.mjs";

const outputDir = process.env.SMOKE_OUTPUT_DIR;
const path = process.argv[2] || "/";
const requiredMarkers = process.argv.slice(3);
const waitUntil = process.env.SMOKE_WAIT || "networkidle";
const timeout = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const debug = process.env.DEBUG === "true";
const log = (...a) => debug && console.log("[smoke]", ...a);

// Requests every browser makes that we never author and don't care about.
const IGNORED_PATHS = [/\/favicon\.ico$/, /\/apple-touch-icon.*/, /\/robots\.txt$/];
const isIgnored = (url) => {
  try {
    const { pathname } = new URL(url);
    return IGNORED_PATHS.some((re) => re.test(pathname));
  } catch {
    return false;
  }
};

main().catch((err) => {
  console.error(`  smoke: FAILED — ${err.message}`);
  process.exit(1);
});

async function main() {
  if (!outputDir) throw new Error("SMOKE_OUTPUT_DIR is not set.");
  ensureStaticOutput(outputDir);

  const server = await startStaticServer({ outputDir });
  const browser = await chromium.launch();
  const problems = [];

  try {
    const page = await browser.newPage();

    page.on("pageerror", (err) => {
      problems.push(`uncaught page error: ${err.message}`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console error: ${msg.text()}`);
    });
    page.on("response", (res) => {
      const status = res.status();
      if (status >= 400 && !isIgnored(res.url())) {
        problems.push(`HTTP ${status} for ${new URL(res.url()).pathname}`);
      }
    });
    page.on("requestfailed", (req) => {
      if (isIgnored(req.url())) return;
      const failure = req.failure();
      problems.push(`request failed for ${new URL(req.url()).pathname}: ${failure?.errorText ?? "unknown"}`);
    });

    const target = `${server.origin}${path.startsWith("/") ? path : `/${path}`}`;
    log(`navigating to ${target}`);
    const response = await page.goto(target, { waitUntil, timeout });
    if (!response) throw new Error(`no response for ${path}`);
    if (response.status() >= 400) throw new Error(`navigation to ${path} returned HTTP ${response.status()}`);

    // Give client hydration a beat to run (and to crash if it's going to).
    await page.waitForTimeout(300);

    const bodyText = (await page.evaluate(() => document.body?.innerText ?? "")).trim();
    if (bodyText.length === 0) {
      problems.push("rendered body is empty (blank page)");
    }

    for (const marker of requiredMarkers) {
      if (!bodyText.includes(marker)) {
        problems.push(`expected visible text not found: "${marker}"`);
      }
    }

    if (problems.length > 0) {
      throw new Error(`\n    - ${problems.join("\n    - ")}`);
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}
