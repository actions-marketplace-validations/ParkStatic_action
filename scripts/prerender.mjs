#!/usr/bin/env node
// Prerenders any Lovable build into static HTML by running a local origin
// server and crawling it with a headless browser.
//
// Two clearly separated modes, picked from BUILD_MODE:
//
//   - "static" (default): the build already emitted index.html plus assets.
//     We serve OUTPUT_DIR over a tiny Node static server with SPA fallback.
//     See serve-static.mjs.
//
//   - "ssr":              the build emitted a Web Fetch handler. We boot it
//     locally and crawl it. The runtime depends on SSR_RUNTIME: "cloudflare"
//     boots the worker via Miniflare (serve-ssr.mjs); "node" runs the plain
//     handler on a generic Node fetch server (serve-fetch.mjs).
//
// Inputs (all via env):
//   OUTPUT_DIR              required, dir to write rendered HTML into
//   BUILD_MODE              "static" (default) or "ssr"
//   SSR_ENTRY               required when BUILD_MODE=ssr, path to server entry
//   SSR_RUNTIME             "cloudflare" (default) or "node" when BUILD_MODE=ssr
//   PRERENDER_ROUTES        optional, newline-separated extra seed paths
//   PRERENDER_EXCLUDE       optional, newline-separated globs to skip
//   PRERENDER_MAX_PAGES     optional, safety cap (default 500)
//   PRERENDER_PAGE_TIMEOUT  optional, per-page timeout in ms (default 15000)
//   PRERENDER_WAIT          optional, Playwright waitUntil (default networkidle)
//   PRERENDER_CONCURRENCY   optional, parallel page workers (default 4)
//   DEBUG                   optional, "true" enables verbose logging

import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath, dirname } from "node:path";

import { ensureStaticOutput, startStaticServer } from "./serve-static.mjs";
import { startSsrServer } from "./serve-ssr.mjs";
import { startFetchServer } from "./serve-fetch.mjs";

const config = readConfig();
const log = makeLogger(config.debug);

main().catch((err) => {
  console.error("::error::Prerender failed:", err?.stack || err);
  process.exit(1);
});

async function main() {
  const server = await startServerForMode(config);
  log(`Origin server (${config.mode}) listening on ${server.origin}`);

  const browser = await chromium.launch();
  try {
    const result = await crawl({
      browser,
      origin: server.origin,
      outputDir: config.outputDir,
      seedPaths: ["/", ...config.seedRoutes, ...readSitemapPaths(config.outputDir)],
      excludeMatchers: config.excludePatterns.map(globToRegExp),
      maxPages: config.maxPages,
      pageTimeoutMs: config.pageTimeoutMs,
      waitUntil: config.waitUntil,
      concurrency: config.concurrency,
      disableHydration: config.disableHydration,
      captureRaw: config.mode === "ssr",
    });
    console.log(`Prerendered ${result.rendered} page(s); skipped ${result.skipped}; failed ${result.failed}.`);
    if (result.notFoundCaptured) {
      console.log("Captured 404.html for unknown-path fallback.");
    }
    if (result.failed > 0) {
      console.log("::warning::One or more pages failed to prerender. The site will still work via SPA fallback at runtime.");
    }
  } finally {
    await browser.close();
    await server.stop();
  }

  // Final sanity check, independent of mode: the deploy step expects an
  // index.html at the root of OUTPUT_DIR. Static mode comes with one; SSR
  // mode has to produce one via the crawl. If neither happened, fail loud.
  if (!existsSync(join(config.outputDir, "index.html"))) {
    throw new Error(`Prerender finished but ${config.outputDir}/index.html is missing — nothing to deploy.`);
  }
}

// --- mode dispatch ----------------------------------------------------------

async function startServerForMode(cfg) {
  if (cfg.mode === "ssr") {
    if (!cfg.ssrEntry) {
      throw new Error("BUILD_MODE=ssr requires SSR_ENTRY to be set.");
    }
    if (cfg.ssrRuntime === "node") {
      return startFetchServer({ ssrEntry: cfg.ssrEntry, assetsDir: cfg.outputDir });
    }
    return startSsrServer({ ssrEntry: cfg.ssrEntry, assetsDir: cfg.outputDir });
  }
  ensureStaticOutput(cfg.outputDir);
  return startStaticServer({ outputDir: cfg.outputDir });
}

// --- config -----------------------------------------------------------------

function readConfig() {
  const outputDir = required("OUTPUT_DIR");
  const mode = (process.env.BUILD_MODE || "static").toLowerCase();
  if (mode !== "static" && mode !== "ssr") {
    throw new Error(`Unknown BUILD_MODE: ${mode} (expected "static" or "ssr")`);
  }
  return {
    mode,
    outputDir: resolvePath(outputDir),
    ssrEntry: process.env.SSR_ENTRY ? resolvePath(process.env.SSR_ENTRY) : null,
    ssrRuntime: (process.env.SSR_RUNTIME || "cloudflare").toLowerCase(),
    seedRoutes: splitLines(process.env.PRERENDER_ROUTES),
    excludePatterns: splitLines(process.env.PRERENDER_EXCLUDE),
    maxPages: positiveInt(process.env.PRERENDER_MAX_PAGES, 500),
    pageTimeoutMs: positiveInt(process.env.PRERENDER_PAGE_TIMEOUT, 15000),
    waitUntil: process.env.PRERENDER_WAIT || "networkidle",
    concurrency: positiveInt(process.env.PRERENDER_CONCURRENCY, 4),
    disableHydration: process.env.DISABLE_HYDRATION === "true",
    debug: process.env.DEBUG === "true",
  };
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required`);
  return value;
}

function splitLines(value) {
  if (!value) return [];
  return value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function makeLogger(debug) {
  return (...args) => {
    if (debug) console.log("[prerender]", ...args);
  };
}

// --- crawler ----------------------------------------------------------------

async function crawl({
  browser,
  origin,
  outputDir,
  seedPaths,
  excludeMatchers,
  maxPages,
  pageTimeoutMs,
  waitUntil,
  concurrency,
  disableHydration,
  captureRaw,
}) {
  const queue = [];
  const seen = new Set();
  const enqueue = (path) => {
    const normalized = normalizePath(path);
    if (!normalized) return;
    if (seen.has(normalized)) return;
    if (excludeMatchers.some((re) => re.test(normalized))) {
      log(`Excluded by pattern: ${normalized}`);
      return;
    }
    seen.add(normalized);
    queue.push(normalized);
  };

  for (const path of seedPaths) enqueue(path);

  const context = await browser.newContext();
  const counters = { rendered: 0, skipped: 0, failed: 0 };

  const worker = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(pageTimeoutMs);
    try {
      while (queue.length > 0 && counters.rendered + counters.failed < maxPages) {
        const path = queue.shift();
        if (!path) continue;
        try {
          const { html, discovered } = await renderPage(page, origin, path, waitUntil, captureRaw);
          if (html === null) {
            counters.skipped++;
            continue;
          }
          const finalHtml = disableHydration ? neutralizeHydration(html) : html;
          writeStaticPage(outputDir, path, finalHtml);
          counters.rendered++;
          log(`Rendered ${path} (+${discovered.length} link(s))`);
          for (const next of discovered) enqueue(next);
        } catch (err) {
          counters.failed++;
          console.log(`::warning::Failed to prerender ${path}: ${err?.message || err}`);
        }
      }
    } finally {
      await page.close();
    }
  };

  const workers = Array.from({ length: Math.max(1, concurrency) }, worker);
  await Promise.all(workers);

  // SSR builds: also capture the framework's not-found page so unknown URLs
  // get a proper 404 at runtime instead of the homepage (whose hydration
  // state is for "/" and blanks the page when replayed at another URL).
  if (captureRaw) {
    counters.notFoundCaptured = await captureNotFoundPage({
      context,
      origin,
      outputDir,
      waitUntil,
      disableHydration,
    });
  }

  await context.close();

  if (queue.length > 0) {
    console.log(`::warning::Hit max-pages cap (${maxPages}); ${queue.length} path(s) remain in queue. Raise PRERENDER_MAX_PAGES if needed.`);
  }

  return counters;
}

// Captures the framework's not-found page to <outputDir>/404.html by probing
// a path that cannot exist. SSR frameworks (TanStack Start et al.) render a
// dedicated notFound route for unmatched URLs, and its hydration state is
// URL-agnostic (root route + notFound), so serving this single file for ANY
// unknown path lets the client hydrate cleanly and show a real 404.
//
// Why this is needed: a static host has no router, so it must fall back to a
// file for unmatched paths. Falling back to the homepage's index.html ships
// hydration state for "/"; replaying that at a different URL trips TanStack
// Router's tiny-invariant and React unmounts to a blank page — exactly the
// "Invariant failed" crash users hit on unknown URLs.
async function captureNotFoundPage({ context, origin, outputDir, waitUntil, disableHydration }) {
  const probePath = `/__parkstatic_not_found_${Date.now().toString(36)}__`;
  const page = await context.newPage();
  try {
    const response = await page.goto(origin + probePath, { waitUntil });
    if (!response) return false;
    const html = await response.text();
    if (!html || !/<\/html>/i.test(html)) return false;
    const finalHtml = disableHydration ? neutralizeHydration(html) : html;
    writeFileSync(join(outputDir, "404.html"), finalHtml, "utf8");
    log(`Captured 404 page from ${probePath} (status ${response.status()})`);
    return true;
  } catch (err) {
    console.log(`::warning::Failed to capture 404 page: ${err?.message || err}`);
    return false;
  } finally {
    await page.close();
  }
}

async function renderPage(page, origin, path, waitUntil, captureRaw) {
  const response = await page.goto(origin + path, { waitUntil });

  // If the SPA bounced us to a different path (e.g. login redirect, 404
  // route), follow the redirect target instead of writing the source path.
  // We intentionally write whatever the final DOM looks like — that matches
  // what a real visitor would see.
  if (response && response.status() >= 400) {
    return { html: null, discovered: [] };
  }

  // Two capture strategies, picked from the build mode:
  //
  //   captureRaw=true  (SSR builds): save the exact bytes the SSR server
  //     emitted, *before* the headless browser hydrated the DOM. That HTML
  //     carries the framework's server markup plus its serialized hydration
  //     state (TanStack Router/Query dehydration, etc.), so a real visitor's
  //     browser can `hydrateRoot()` against it cleanly and the app boots into
  //     a fully interactive SPA — theme toggles, Framer Motion, modals and
  //     client routing all keep working. This is true SSG, not a snapshot.
  //
  //     Capturing `page.content()` here instead would serialize the *post*-
  //     hydration DOM; reloading that trips a hydration mismatch (TanStack's
  //     tiny-invariant) and React unmounts to a blank page — which is exactly
  //     why SSR builds used to need hydration stripped.
  //
  //   captureRaw=false (SPA builds): the server only ever returns an empty
  //     `<div id="root">` shell, so there is nothing meaningful to save from
  //     the raw response. We capture the post-hydration DOM for real content
  //     (SEO / first paint); on reload the SPA mounts via `createRoot()` and
  //     simply re-renders over it, so interactivity is preserved with no
  //     hydration-mismatch risk.
  const htmlPromise = captureRaw && response ? response.text() : page.content();
  const [rawHtml, hrefs] = await Promise.all([
    htmlPromise,
    page.$$eval("a[href]", (els) => els.map((el) => el.getAttribute("href"))),
  ]);

  // `page.content()` serializes the post-hydration DOM, and a hydrated app
  // often injects <link rel="modulepreload"> / <link rel="prefetch"> tags for
  // its chunks at runtime. The browser resolves those hrefs against the crawl
  // origin, so the serialized markup carries absolute http://127.0.0.1:<port>
  // URLs that point at the (now-stopped) crawl server. Left as-is they break
  // the packaged build for real visitors AND the smoke test. Rebase anything
  // pointing back at our own origin to a root-relative path.
  const html = rebaseOrigin(rawHtml, origin);

  const finalPath = new URL(page.url()).pathname;
  const discovered = collectInternalLinks(hrefs, origin, finalPath);

  return { html, discovered };
}

// Rewrites absolute URLs that point at the crawl origin back to root-relative
// paths (http://127.0.0.1:<port>/_app/x.js -> /_app/x.js). Only exact-origin
// matches are touched; cross-origin URLs (CDN-hosted chunks, third-party
// scripts) are preserved verbatim.
function rebaseOrigin(html, origin) {
  if (!origin || !html.includes(origin)) return html;
  return html.split(origin).join("");
}

function collectInternalLinks(hrefs, origin, currentPath) {
  const results = [];
  for (const raw of hrefs) {
    if (!raw) continue;
    if (raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue;
    if (raw.startsWith("#")) continue;
    let url;
    try {
      url = new URL(raw, origin + currentPath);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (url.hash && url.pathname === currentPath) continue;
    results.push(url.pathname || "/");
  }
  return results;
}

// --- output -----------------------------------------------------------------

// Strips locally-hosted `<script type="module">` tags from the rendered HTML
// so the framework's hydration entry never runs in the visitor's browser.
//
// Why we need this: Playwright's `page.content()` returns a DOM snapshot
// that has already been hydrated by the headless browser. Reloading that
// snapshot in a real browser kicks the framework into a *second* hydration
// pass against state that no longer exists; TanStack Router (and similar
// SSR-only setups) trip a `tiny-invariant` assertion and React unmounts
// the whole tree, leaving a blank page.
//
// Killing the entry script keeps the SSR'd DOM exactly as captured: text,
// images, CSS animations, videos, iframes, native forms, hover effects,
// and any third-party (external `src`) scripts all still work. The cost
// is React-driven interactivity — modals, client-side routing, Framer
// Motion, Lottie, etc. That trade-off is the deal Parkstatic users sign
// up for; the input `disable-hydration: false` opts back in.
//
// Heuristics:
//   - Only `<script type="module">` is targeted. Vite-style builds put
//     their entry there; classic `<script>` tags (analytics, third-party
//     widgets) are left alone.
//   - Module scripts with an `src` starting with `http://` or `https://`
//     are preserved — these are almost always external libraries the user
//     added, not the framework's own entry.
//   - Inline `<script type="module">` blocks are removed; Vite occasionally
//     emits inline hydration glue.
//   - `<link rel="modulepreload">` tags are also removed. Without the
//     hydration entry there is nothing to import these chunks, and on a
//     slow shared host every preload is a full request that ties up a
//     connection slot during the critical render window — which can be
//     enough on its own to time out Lighthouse / PageSpeed Insights runs.
//     Same-origin only: cross-origin preloads (rare, but valid for users
//     hosting chunks on a CDN) are preserved on the assumption that the
//     user wired them up deliberately.
function neutralizeHydration(html) {
  return html
    .replace(
      /<script\b([^>]*\btype\s*=\s*["']?module["']?[^>]*)>([\s\S]*?)<\/script>/gi,
      (match, attrs) => {
        const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
        if (srcMatch && /^https?:\/\//i.test(srcMatch[1])) {
          return match;
        }
        return "";
      },
    )
    .replace(
      /<link\b([^>]*\brel\s*=\s*["']?modulepreload["']?[^>]*)\/?>/gi,
      (match, attrs) => {
        const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
        if (hrefMatch && /^https?:\/\//i.test(hrefMatch[1])) {
          return match;
        }
        return "";
      },
    );
}

// Writes the rendered DOM to OUTPUT_DIR. The root path overwrites
// OUTPUT_DIR/index.html; nested paths become OUTPUT_DIR/<path>/index.html so
// any static host (and the Parkstatic WP plugin's directory-style resolver)
// can serve them with no rewrite rules.
function writeStaticPage(outputDir, path, html) {
  const target = path === "/"
    ? join(outputDir, "index.html")
    : join(outputDir, path.replace(/^\/+/, ""), "index.html");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html, "utf8");
}

function normalizePath(input) {
  if (typeof input !== "string") return null;
  if (!input.startsWith("/")) input = "/" + input;
  let path = input.split("#")[0].split("?")[0];
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  // Guard: only same-origin, no traversal. We're using URL parsing for safety.
  try {
    const url = new URL(path, "http://internal");
    return url.pathname || "/";
  } catch {
    return null;
  }
}

// --- helpers ----------------------------------------------------------------

// Pulls extra seed routes out of sitemap.xml if the build emitted one.
// Best-effort and tolerant: regex over <loc>...</loc>, ignore malformed files.
function readSitemapPaths(outputDir) {
  const sitemap = join(outputDir, "sitemap.xml");
  if (!existsSync(sitemap)) return [];
  try {
    const xml = readFileSync(sitemap, "utf8");
    const paths = [];
    for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      try {
        const url = new URL(match[1]);
        paths.push(url.pathname);
      } catch {
        // Relative URLs in sitemaps are non-standard, but accept them.
        paths.push(match[1]);
      }
    }
    return paths;
  } catch {
    return [];
  }
}

// Minimal glob -> RegExp. Supports `*` (single path segment) and `**` (any).
// Other regex metacharacters are escaped. Pattern is anchored.
function globToRegExp(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (".+?^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}
