# Parkstatic Build and Deploy

GitHub Action to build and deploy static frontends to
[Parkstatic](https://parkstatic.site) — Vite SPAs, TanStack Start, React Router,
Remix, Astro, SvelteKit, Nuxt, and other frameworks that ship a standard `build`
script and produce a static output directory.

## Prerequisites

- A [Parkstatic](https://parkstatic.site) instance with an **active paid
  license**
- Parkstatic set up in WordPress admin (the deploy secret is shown under
  Parkstatic → General → Deploy secret)
- That deploy secret stored as a repository secret named `PARKSTATIC_SECRET`

## Usage

Add a workflow file to your repository (for example
`.github/workflows/deploy.yml`):

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: ParkStatic/action@main
        with:
          parkstatic-secret: ${{ secrets.PARKSTATIC_SECRET }}
```

Pin to a specific release tag (for example `v1.0.0`) for reproducible builds.

## Hosting requirements

Most client-routed SPAs work best when served from the **root** of a domain
(e.g. `https://customer.com/`). Parkstatic handles this case out of the box.

If WordPress runs in a subdirectory (`https://example.com/landing/`), your app's
router may need its base path adjusted to match. Either:

- Run WordPress at the domain root (recommended), or
- Set Vite's `base` and your router's `basename` to the subdirectory before
  deploying.

Static assets work on both root and subdirectory installs.

## How it works

The action checks out your repo, installs dependencies, runs your project's
`build` script, prepares a static site suitable for WordPress hosting, and
uploads it to your Parkstatic instance. Your WordPress site picks up the new
build shortly after the workflow finishes.

The action never modifies your repository — no commits, branches, or PRs.

## Framework support

The action runs your project's own `build` script, locates the static output it
produced, prerenders it with a headless browser if needed, and ships the result.
Framework-specific build knowledge (which output directory to expect, which
dependencies to inject) is resolved by the Parkstatic plan endpoint, with a
conservative local fallback when the endpoint is unreachable. You can always
override detection with the `build-command` and `output-dir` inputs.

### Supported — static output

These frameworks produce a static directory the action can locate and deploy
directly. Output paths listed are the defaults the action looks for.

| Framework                              | Build output        | Notes                                                                 |
| -------------------------------------- | ------------------- | --------------------------------------------------------------------- |
| Vite SPA (React, Vue, Svelte, Solid…)  | `dist`              | Empty-shell SPA; the prerender crawl captures the hydrated DOM.       |
| TanStack Start (prerendered)           | `dist/client`       | Framework's own prerendered HTML is deployed verbatim; crawl skipped. |
| TanStack Start / Vite SSR (Node)       | `dist/client`       | SSR handler booted on a local Node fetch server, then crawled.        |
| TanStack Start SSR (Cloudflare)        | `dist/client`       | SSR worker booted via Miniflare, then crawled.                       |
| React Router (framework mode)          | `build/client`      | Static or SPA build.                                                  |
| Remix (Vite, SPA mode `ssr: false`)    | `build/client`      | Static `index.html` shell; crawl captures the hydrated route.         |
| Astro                                  | `dist`              | Fully prerendered at build time.                                      |
| SvelteKit (`adapter-static`)           | `build`             | Prerender every route (`export const prerender = true`).              |
| Nuxt (`nuxt generate`)                 | `.output/public`    | Static generation.                                                    |
| Next.js (`output: 'export'`)           | `out`               | Static export only (see below).                                       |

### Not supported

| Framework / shape                    | Why                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js SSR / SSG (default `.next`)  | Next's server runtime differs from the TanStack Start / Vite-SSR shape the action boots; there is no adapter for the Next standalone server.   |
| Frameworks with no `build` script    | The action relies on your project's `build` script (or a recognized frontend dependency) to produce output. A bare `index.html` repo won't build. |
| Non-JavaScript static sites          | The action expects a `package.json` and a Node build. Plain HTML/CSS sites with no build step are not handled.                                 |

If your framework produces a static `index.html` somewhere not listed above,
point the action at it with `output-dir`. If it needs a non-`build` script, pass
`build-command`.

## Inputs

| Input                   | Required | Default | Description                                                            |
| ----------------------- | -------- | ------- | ---------------------------------------------------------------------- |
| `parkstatic-secret`     | yes      | —       | Deploy secret from WordPress admin                                     |
| `node-version`          | no       | `22`    | Node.js version for the build                                          |
| `pnpm-version`          | no       | `10`    | pnpm version for the build                                             |
| `build-command`         | no       | —       | Override the build command                                             |
| `output-dir`            | no       | —       | Override the build output directory                                    |
| `prerender`             | no       | `true`  | Generate static HTML for routes (recommended for SPAs)                 |
| `prerender-routes`      | no       | —       | Extra paths to include, one per line                                   |
| `prerender-exclude`     | no       | —       | Paths to skip, one glob per line (e.g. `/admin/**`)                    |
| `prerender-max-pages`   | no       | `500`   | Maximum number of pages to generate                                    |
| `prerender-concurrency` | no       | `4`     | Parallel page workers                                                  |
| `disable-hydration`     | no       | —       | Set to `true` for a static-only site without client-side interactivity |
| `debug`                 | no       | `false` | Verbose logging                                                        |

## Outputs

| Output       | Description                              |
| ------------ | ---------------------------------------- |
| `output-dir` | Build output directory that was deployed |
| `deployed`   | Whether the upload succeeded             |
| `deploy-id`  | ID for this deploy, useful in support    |

## Troubleshooting

If a workflow fails, verify in WordPress admin that Parkstatic is set up, your
license is active, and the `PARKSTATIC_SECRET` repository secret matches the
current deploy secret.

## License

Proprietary — all rights reserved. See [LICENSE](LICENSE).

You may use this action only by referencing official releases in GitHub Actions
workflows. Copying, forking, or reusing this source code requires written
permission from ParkStatic.
