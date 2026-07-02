#!/usr/bin/env node
// Resolves the build plan for this repo and writes it to GITHUB_OUTPUT for the
// downstream install/inject/build/prerender steps to consume.
//
// The plan is fetched from the ParkStatic `plan` edge function, which holds the
// proprietary, frequently-updated build knowledge (which deps to inject in CI,
// which native build deps to allow, how to build). The action stays a thin
// interpreter of the returned declarative plan — it never executes server-
// provided shell.
//
// Resilience: any failure (no endpoint, network error, non-2xx, unknown token,
// unrecognized planVersion) drops to a conservative LOCAL fallback computed from
// package.json. The fallback is intentionally the action's already-public
// baseline (esbuild/@swc allowlist + the @tanstack/query-core fix), so paying
// users keep building during a plan outage while new server-side recipes stay
// off the public path. The deploy function remains the real auth/payment gate.
//
// Inputs (all via env):
//   GITHUB_OUTPUT       required, file the resolved outputs are appended to
//   PLAN_FILE           optional, path to a local JSON plan; when set the remote
//                       and local-fallback plans are skipped entirely (dry runs,
//                       air-gapped builds, the framework-compatibility tests)
//   PLAN_URL            optional, plan endpoint; empty disables the remote call
//   PARKSTATIC_SECRET   optional, bearer token for the plan endpoint
//   PRERENDER_INPUT     optional, the action's `prerender` input ("true"/"false")
//   DEBUG               optional, "true" enables verbose logging

import { appendFileSync, existsSync, readFileSync } from "node:fs";

const PLAN_VERSION = 1;
const REQUEST_TIMEOUT_MS = 15_000;
const BUILT_DEPENDENCIES = ["esbuild", "@swc/core"];

// Static output directory each framework writes its build to. The action uses
// this hint to locate the deployable output; it falls back to a candidate-list
// heuristic when outputDir is absent. Vite-only SPAs omit it on purpose.
const STATIC_OUTPUT_DIRS = {
    "astro": "dist",
    "@sveltejs/kit": "build",
    "@remix-run/dev": "build/client",
    "@react-router/dev": "build/client",
    "nuxt": ".output/public",
    "next": "out",
};

const debug = process.env.DEBUG === "true";
const log = (...args) => debug && console.log("[plan]", ...args);

main();

async function main() {
    const pkg = readPackageJson();
    const local = computeLocalPlan(pkg);

    // A local plan file short-circuits everything: no server call, no fallback.
    // This is how dry runs, air-gapped builds, and the framework-compatibility
    // test suite feed a deterministic plan without a paid license or network.
    const filePlan = readPlanFile();
    const remote = filePlan ? null : await fetchRemotePlan(pkg);
    const plan = filePlan ?? remote ?? local;
    const source = filePlan ? "file" : remote ? "plan" : "fallback";

    for (const notice of plan.notices ?? []) {
        console.log(`::notice::${notice}`);
    }
    if (plan.supported === false) {
        console.log(`::warning::Plan reports project as unsupported: ${plan.reason ?? "no reason given"}`);
    }
    if (filePlan) {
        log(`Using local plan file from ${process.env.PLAN_FILE}.`);
    } else if (!remote) {
        log("Using local fallback plan.");
    }

    const prerenderEnabled = process.env.PRERENDER_INPUT === "false"
        ? false
        : plan.prerender?.recommended !== false;

    writeOutputs({
        "built-deps": (plan.install?.builtDependencies ?? BUILT_DEPENDENCIES).join(" "),
        "inject-deps": (plan.injectDependencies ?? []).join(" "),
        "build-kind": plan.build?.kind ?? local.build.kind,
        "build-script": plan.build?.script ?? "build",
        "plan-output-dir": plan.build?.outputDir ?? "",
        "prerender-enabled": String(prerenderEnabled),
        "plan-source": source,
    });

    console.log(
        `Build plan resolved from ${source}: build=${plan.build?.kind ?? local.build.kind}, ` +
        `output=${plan.build?.outputDir ?? "(auto)"}, ` +
        `inject=[${(plan.injectDependencies ?? []).join(", ")}], prerender=${prerenderEnabled}.`,
    );
}

function readPackageJson() {
    if (!existsSync("package.json")) {
        // detect.sh already guarantees this; guard anyway so we degrade to an
        // empty object rather than throwing.
        return {};
    }
    try {
        return JSON.parse(readFileSync("package.json", "utf8"));
    } catch (err) {
        log("Failed to parse package.json:", err?.message || err);
        return {};
    }
}

// Reads and validates a local plan file when PLAN_FILE is set. Returns the plan
// object, or null when PLAN_FILE is unset. A set-but-invalid file is a
// configuration error the caller asked for explicitly, so we fail loud rather
// than silently dropping to the remote/local path.
function readPlanFile() {
    const file = process.env.PLAN_FILE;
    if (!file) {
        return null;
    }
    if (!existsSync(file)) {
        console.log(`::error::plan-file '${file}' was provided but does not exist.`);
        process.exit(1);
    }
    let plan;
    try {
        plan = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
        console.log(`::error::plan-file '${file}' is not valid JSON: ${err?.message || err}`);
        process.exit(1);
    }
    if (!plan || typeof plan !== "object") {
        console.log(`::error::plan-file '${file}' does not contain a plan object.`);
        process.exit(1);
    }
    if (plan.planVersion !== PLAN_VERSION) {
        console.log(
            `::error::plan-file '${file}' has planVersion ${plan.planVersion}, but this action only supports ${PLAN_VERSION}.`,
        );
        process.exit(1);
    }
    return plan;
}

function listLockfiles() {
    return ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"].filter((f) => existsSync(f));
}

// Mirrors the plan edge function's logic so behavior is identical when the
// endpoint is unreachable. Kept deliberately conservative: only the
// already-public query-core fix is injected here. Framework output-path
// knowledge lives here too so the offline fallback still locates builds for the
// common static frameworks — the edge function is the real source of truth and
// may override this with `build.outputDir`.
function computeLocalPlan(pkg) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);

    const injectDependencies = [];
    const notices = [];
    if (has("@tanstack/react-query") && !has("@tanstack/query-core")) {
        injectDependencies.push("@tanstack/query-core");
        notices.push("Injecting @tanstack/query-core (missing in many Lovable projects).");
    }

    const hasBuildScript = !!(pkg.scripts && typeof pkg.scripts === "object" && "build" in pkg.scripts);

    // The first matching framework wins an output-dir hint. Vite-only SPAs
    // leave outputDir empty so build.sh falls back to its candidate-list
    // heuristic (dist/client, dist, build, ...).
    let outputDir = "";
    for (const [dep, dir] of Object.entries(STATIC_OUTPUT_DIRS)) {
        if (has(dep)) {
            outputDir = dir;
            break;
        }
    }

    return {
        planVersion: PLAN_VERSION,
        supported: true,
        install: { builtDependencies: BUILT_DEPENDENCIES },
        injectDependencies,
        build: hasBuildScript
            ? { kind: "package-script", script: "build", outputDir }
            : { kind: "vite-build", script: "build", outputDir },
        prerender: { recommended: true },
        notices,
    };
}

async function fetchRemotePlan(pkg) {
    const url = process.env.PLAN_URL;
    const token = process.env.PARKSTATIC_SECRET;
    if (!url || !token) {
        log("PLAN_URL or PARKSTATIC_SECRET unset; skipping remote plan.");
        return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
                "User-Agent": "ParkStatic-Plan/1.0",
            },
            body: JSON.stringify({ packageJson: pkg, lockfiles: listLockfiles() }),
        });

        // A 403 is an authoritative "this site has no active paid license". Unlike
        // a transient outage, building further is pointless — the deploy step
        // would only fail the same way after a full build. Fail fast here with a
        // clear message instead of silently dropping to the local fallback.
        if (res.status === 403) {
            const body = await res.text().catch(() => "");
            log(`Plan endpoint 403: ${body}`);
            console.log(
                "::error::This Parkstatic site does not have an active paid license. " +
                "Activate or renew your license in WordPress admin (Parkstatic \u2192 Account) and try again.",
            );
            process.exit(1);
        }

        if (!res.ok) {
            log(`Plan endpoint returned HTTP ${res.status}; falling back to local plan.`);
            return null;
        }

        const data = await res.json().catch(() => null);
        const plan = data?.plan;
        if (!plan || typeof plan !== "object") {
            log("Plan response missing a plan object; falling back.");
            return null;
        }
        if (plan.planVersion !== PLAN_VERSION) {
            console.log(
                `::warning::Plan endpoint returned planVersion ${plan.planVersion}, but this action only supports ${PLAN_VERSION}. Falling back to local plan; consider updating the action.`,
            );
            return null;
        }
        return plan;
    } catch (err) {
        const reason = err?.name === "AbortError" ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s` : (err?.message || err);
        log(`Plan request failed (${reason}); falling back to local plan.`);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function writeOutputs(outputs) {
    const file = process.env.GITHUB_OUTPUT;
    if (!file) {
        throw new Error("GITHUB_OUTPUT environment variable is required");
    }
    const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    appendFileSync(file, lines);
}
