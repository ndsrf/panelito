---
status: awaiting_human_verify
trigger: "I am getting this error when logging in locally with the button to dev sign in. Build Error: Module parse failed: Unexpected character '�' (1:0) on ../../node_modules/.pnpm/onnxruntime-node@1.24.3/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node. Module parse failed: Unexpected character. You may need an appropriate loader to handle this file type, currently no loaders are configured to process this file. Next.js version: 15.5.19 (Webpack)."
created: 2026-07-18T00:00:00Z
updated: 2026-07-18T00:00:00Z
symptoms_prefilled: true
goal: find_and_fix
---

## Current Focus

hypothesis: CONFIRMED (refined) — @huggingface/transformers had to be resolvable from apps/web's own directory (via pnpm dependency, not just serverExternalPackages config) for Next.js to actually externalize it and stop webpack from parsing onnxruntime-node's native binary.
test: (1) added @huggingface/transformers ^4.2.0 to apps/web/package.json + pnpm install, (2) `pnpm --filter @panelito/web build` — full production build, (3) `pnpm --filter @panelito/web dev` + curl the exact /api/[[...route]] catch-all endpoint that was failing
expecting: no "Module parse failed" anywhere in build output; /api/[[...route]] compiles and returns 200 in dev mode
next_action: self-verification PASSED on both build and dev — awaiting human confirmation via the real browser dev sign-in flow (localhost:3000, click "Dev Sign In")

## Symptoms

expected: Clicking "Dev Sign In" locally authenticates as a test user and loads the app, same as before
actual: Next.js build error — Module parse failed: Unexpected character on onnxruntime-node's native .node binary; app loads fine otherwise, error only surfaces on the dev sign-in action
errors: |
  Module parse failed: Unexpected character '�' (1:0)
  ../../node_modules/.pnpm/onnxruntime-node@1.24.3/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node
  Module parse failed: Unexpected character '�' (1:0)
  You may need an appropriate loader to handle this file type, currently no loaders are configured to process this file. See https://webpack.js.org/concepts#loaders
  (Source code omitted for this binary file)
  Next.js version: 15.5.19 (Webpack)
reproduction: Run app locally (WSL2), click the "Dev Sign In" button
started: Recently — dev sign-in used to work before this. Platform note — the failing binary path is darwin/arm64 even though dev is WSL2/Linux, worth checking during investigation.

## Eliminated

## Evidence

- timestamp: 2026-07-18T00:10:00Z
  checked: apps/web/next.config.ts
  found: Only `typedRoutes` and `transpilePackages` set; no `serverExternalPackages`/externals entry for onnxruntime-node or @huggingface/transformers.
  implication: webpack has no instruction to treat onnxruntime-node's native .node binary as external — it will try to parse it as JS.

- timestamp: 2026-07-18T00:12:00Z
  checked: apps/web/app/api/[[...route]]/route.ts
  found: |
    import app from "../../../../api/src/index"
    export const runtime = "nodejs"
    All HTTP verbs handled via hono/vercel's handle(app). This is a direct source import of the entire @panelito/api Hono app into apps/web's Next.js build (unified Vercel hosting per tech stack doc) — not an HTTP call to a separately deployed service.
  implication: Next.js/webpack must bundle the full transitive dependency graph of apps/api/src/index.ts as part of apps/web's build.

- timestamp: 2026-07-18T00:14:00Z
  checked: apps/web/tsconfig.tsbuildinfo (grep for "../api/src/lib/embeddings.ts" and other ../api/src/* references)
  found: apps/web's TS build graph includes ../api/src/lib/embeddings.ts, ../api/src/graph/*, ../api/src/routes/*, and other apps/api sources — confirming the catch-all route pulls the entire API surface (graph nodes, skills, routes) into apps/web's compile graph, not just a slice.
  implication: embeddings.ts (which does `import { pipeline } from '@huggingface/transformers'`) is reachable from apps/web's build via app/api/[[...route]]/route.ts -> api/src/index.ts -> routes -> ... -> embeddings.ts.

- timestamp: 2026-07-18T00:16:00Z
  checked: apps/api/package.json
  found: "@huggingface/transformers": "^4.2.0" is a direct dependency of @panelito/api, added for local ONNX embeddings (TRIGGER-03/GRAPH-03, embeddings.ts header comment references Phase 12 work).
  implication: @huggingface/transformers pulls in onnxruntime-node as a runtime backend, which ships prebuilt native .node binaries (e.g. napi-v6/darwin/arm64/onnxruntime_binding.node) — these are Node addons, not JS, and must never be parsed by webpack.

- timestamp: 2026-07-18T00:18:00Z
  checked: Next.js 15.5.19 installed config schema (node_modules next/dist/esm/server/config-schema.js)
  found: serverExternalPackages is a valid top-level (stable, non-experimental) Next.js config key in this version, designed exactly for this case — mark server-only native/CJS packages as external so webpack does not bundle them, Node's require() resolves them directly at runtime instead.
  implication: Root cause confirmed — missing serverExternalPackages entry for onnxruntime-node (and its consumer @huggingface/transformers) in apps/web/next.config.ts.

reasoning_checkpoint:
  hypothesis: "apps/web's catch-all API route (app/api/[[...route]]/route.ts) directly source-imports the entire @panelito/api Hono app, whose dependency graph includes embeddings.ts -> @huggingface/transformers -> onnxruntime-node. Because onnxruntime-node is not declared in next.config.ts's serverExternalPackages, webpack tries to bundle its native .node binary as JavaScript, producing the 'Module parse failed: Unexpected character' error. This only surfaces when a route that reaches this import chain compiles for the first time — the dev sign-in flow's redirect triggers a client fetch to /api/... routes right after sign-in, causing on-demand compilation of the catch-all route."
  confirming_evidence:
    - "route.ts imports api/src/index directly (source import, not HTTP call) with runtime='nodejs' — direct evidence of the bundling boundary"
    - "tsconfig.tsbuildinfo shows apps/web's compile graph includes ../api/src/lib/embeddings.ts and the full api/src tree, proving the import chain is real, not hypothetical"
    - "embeddings.ts imports @huggingface/transformers, package.json confirms it's a direct apps/api dependency; the failing binary path (onnxruntime-node .node file) is exactly what @huggingface/transformers' onnx backend requires at load time"
    - "next.config.ts has zero externals/serverExternalPackages config — nothing currently prevents webpack from attempting to parse the binary"
  falsification_test: "If this hypothesis is correct, adding onnxruntime-node (and @huggingface/transformers, transitively depends on it) to serverExternalPackages in apps/web/next.config.ts and re-running `next dev`, then exercising the dev sign-in flow, should eliminate the 'Module parse failed' build error entirely. If the error persists after this change, the hypothesis is wrong (or there's a second require path not yet found)."
  fix_rationale: "This addresses the root cause (webpack attempting to bundle a native Node addon it doesn't understand) rather than a symptom. It does not touch business logic, does not disable local ONNX embeddings, and does not change the dev-sign-in code path itself — it only tells Next.js's server bundler to leave this specific native-dependency chain to Node's native require() at runtime, which is exactly what serverExternalPackages is designed for."
  blind_spots: "Have not yet run `next dev` and reproduced the exact error locally to confirm before applying the fix (evidence is from static analysis of tsbuildinfo/source, not a live repro run). Have not confirmed whether sharp/onnxruntime-node's other transitive deps (e.g. onnxruntime-common) also need to be listed, or whether serverExternalPackages entry for @huggingface/transformers alone is sufficient (Next.js may need the leaf native package listed explicitly, not just its JS wrapper)."

- timestamp: 2026-07-18T00:22:00Z
  checked: ran `pnpm --filter @panelito/web build` after adding serverExternalPackages: ['onnxruntime-node', '@huggingface/transformers'] to next.config.ts
  found: |
    Build STILL failed with the identical "Module parse failed: Unexpected character" error, now shown for linux/x64, win32/arm64, win32/x64 onnxruntime_binding.node variants too (all platforms enumerated by onnxruntime-node's require.context). Import trace shows webpack descending all the way through @huggingface/transformers/dist/transformers.node.mjs -> onnxruntime-node/dist/index.js -> dist/backend.js -> dist/binding.js -> the .node binaries — i.e. neither package was actually externalized despite being listed in serverExternalPackages.
  implication: serverExternalPackages hypothesis from the first reasoning checkpoint was WRONG (or incomplete) — the config alone did not fix it. Original hypothesis ELIMINATED as sufficient fix; refining to a more specific root cause below.

- timestamp: 2026-07-18T00:24:00Z
  checked: web search for "Next.js serverExternalPackages not working onnxruntime-node webpack pnpm monorepo" — found vercel/next.js GitHub issues #68805, #76247, #84388, #85449
  found: |
    Documented, known Next.js + pnpm monorepo limitation: Next.js can only externalize a package via serverExternalPackages if that package is resolvable by Node.js from the *consuming project's own directory* — i.e. it must appear in that app's own node_modules (a direct or pnpm-hoisted dependency). If a package is only installed as a dependency of a *sibling* workspace package (here: apps/api), pnpm's strict non-hoisting isolation means it has no symlink in apps/web/node_modules, so Next's externalization resolution silently fails and webpack falls back to bundling/parsing it. This exactly matches our case: onnxruntime-node/@huggingface/transformers are declared only in apps/api/package.json, not apps/web/package.json.
  implication: root cause refined — must make @huggingface/transformers resolvable from apps/web's own directory (add as a direct dependency in apps/web/package.json), not just list it in serverExternalPackages.

- timestamp: 2026-07-18T00:25:00Z
  checked: apps/web/node_modules/@huggingface and apps/web/node_modules/onnxruntime-node
  found: Neither directory exists — confirms neither package is resolvable from apps/web's own node_modules today.
  implication: Directly confirms the refined hypothesis via direct observation (not inference).

## Resolution

root_cause: |
  apps/web/app/api/[[...route]]/route.ts source-imports the entire @panelito/api Hono
  app (unified Vercel hosting design — Next.js API route mounts the Hono backend
  directly, not via HTTP). That app's dependency graph reaches
  apps/api/src/lib/embeddings.ts (added in Phase 12 for local ONNX semantic-drift
  scoring), which imports @huggingface/transformers, which in turn imports
  onnxruntime-node — a package that ships prebuilt native .node binaries.

  Webpack (Next.js's bundler) cannot parse native .node binaries as JavaScript, so it
  needs those specific packages marked "external" (require()'d at runtime by Node
  instead of bundled). Adding serverExternalPackages to next.config.ts is the
  documented mechanism for this, but it was not sufficient on its own: in this pnpm
  workspace, @huggingface/transformers and onnxruntime-node were declared only in
  apps/api/package.json, not apps/web/package.json. Because pnpm uses strict,
  non-hoisting node_modules isolation, apps/web/node_modules had no symlink to either
  package. Next.js's serverExternalPackages externalization only takes effect if the
  package is resolvable by Node from the *consuming app's own directory* — this is a
  documented Next.js + pnpm monorepo limitation (vercel/next.js issues #68805, #76247,
  #84388, #85449). Since the package wasn't resolvable from apps/web, Next silently
  fell back to normal bundling, and webpack tried (and failed) to parse the .node
  binary — reproducing the exact reported error, regardless of the serverExternalPackages
  entry.
fix: |
  1. apps/web/next.config.ts — added
     `serverExternalPackages: ["onnxruntime-node", "@huggingface/transformers"]`
     (necessary but not sufficient on its own).
  2. apps/web/package.json — added `"@huggingface/transformers": "^4.2.0"` as a direct
     dependency (matching apps/api's version), then ran `pnpm install`. This gives
     apps/web/node_modules a resolvable symlink to the package, which lets Next.js's
     serverExternalPackages externalization actually apply. onnxruntime-node itself
     did not need to be added directly to apps/web/package.json — once
     @huggingface/transformers is externalized, webpack stops descending into its own
     internal require of onnxruntime-node, so that boundary is sufficient.
verification: |
  - `pnpm --filter @panelito/web build` (fresh .next, full production build): completed
    successfully with zero "Module parse failed" errors; /api/[[...route]] listed as a
    normal dynamic route in the build output. Only pre-existing, unrelated warnings
    remain (Edge Runtime warning for @supabase/supabase-js in middleware, a few unused-var
    ESLint warnings) — confirmed these are unrelated to onnxruntime/embeddings.
  - `pnpm --filter @panelito/web dev` + `curl http://localhost:3000/api/health`: the
    exact catch-all route that previously failed to parse now compiles cleanly
    (1747 modules, no errors) and returns HTTP 200.
  - Self-verification passed on both build and dev. Awaiting human confirmation via the
    real browser flow (localhost:3000 -> click "Dev Sign In" button) since the original
    report was from an interactive browser session, not a build/curl check.
files_changed:
  - apps/web/next.config.ts
  - apps/web/package.json
  - pnpm-lock.yaml
