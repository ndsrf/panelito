---
status: resolved
trigger: "I cannot see the userid in the langfuse traces. Also I see a lot of entries in Langfuse with type = facilitation_coach but nothing for the analista."
created: 2026-07-18T21:15:00Z
updated: 2026-07-18T22:30:00Z
symptoms_prefilled: true
goal: find_and_fix
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "No OpenTelemetry ContextManager is ever registered (no @opentelemetry/context-async-hooks dependency, no context.setGlobalContextManager() call anywhere in the repo) because langfuse-otel.ts's setupLangfuseOtel() only calls trace.setGlobalTracerProvider()/setLangfuseTracerProvider(). This leaves @opentelemetry/api's default NoopContextManager active. NoopContextManager.with(ctx, fn) IGNORES ctx and just calls fn() directly, and NoopContextManager.active() always returns ROOT_CONTEXT. CallbackHandler.handleChainStart's userId injection (via @langfuse/core's propagateAttributes -> otelContextApi.with(contextWithUserId, fn)) therefore never actually makes the userId value observable via context.active().getValue(...) inside fn, so no span (root LangChain trace span, nor any manual startObservation() span in langfuse-generation.ts) ever reads a userId from context. Root cause is a single missing bootstrap call, not a data/resolver bug — resolveCreatorLangfuseUserId itself is correct and always returns a non-empty string."
  confirming_evidence:
    - "grep across the whole repo (apps/api/src, all workspaces) for setGlobalContextManager/AsyncLocalStorageContextManager/AsyncHooksContextManager returns zero matches; @opentelemetry/context-async-hooks is not even a dependency in apps/api/package.json or resolved in node_modules/.pnpm."
    - "Read node_modules NoopContextManager.js source directly: with(_context, fn, thisArg, ...args) { return fn.call(thisArg, ...args); } — the passed context is discarded entirely; active() always returns context_1.ROOT_CONTEXT."
    - "Direct executable reproduction (node ESM script run inside apps/api so @opentelemetry/api resolves from the real node_modules): context.with(ctx.setValue(key,'hello-userid'), () => { observed = context.active().getValue(key) }) -> observed logged as `undefined`, both inside the with() callback and after it returns. Confirms the exact mechanism CallbackHandler/propagateAttributes relies on is a no-op in this codebase's current OTel bootstrap."
    - "Read @langfuse/core's propagateAttributes (dist/index.mjs ~L14905-15022): builds a new context via context.setValue(...) for userId/sessionId/tags/etc, then does `return otelContextApi.with(context, fn)` — this is exactly the call proven to be a no-op above. It also tries a same-call fallback of span.setAttribute(...) directly on `otelTraceApi.getActiveSpan()`, but that variable is captured BEFORE the new span exists for a root (parentRunId-less) chain start, so it is undefined/non-recording for the very case (root trace) CallbackHandler uses it for."
  falsification_test: "If a context manager IS registered elsewhere (e.g. via a Next.js instrumentation.ts, a bridge/edge entrypoint, or Hono middleware not yet read) that this investigation missed, then context.with() would actually persist values and userId would show up on SOME traces — re-run the same node reproduction script but importing the actual apps/api/src/server.ts entrypoint (or grep every entrypoint file: server.ts, index.ts, Next.js bridge routes) for any tracer/context bootstrap code path not yet inspected."
  fix_rationale: "Adding one line — otelApi.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable()) — inside setupLangfuseOtel() (alongside the existing setGlobalTracerProvider/setLangfuseTracerProvider calls, guarded by the same idempotency check) makes context.with()/context.active() actually propagate via Node's AsyncLocalStorage across the awaited async graph execution. This directly repairs the mechanism propagateAttributes depends on, rather than patching around it (e.g. manually re-setting userId per span) — it's the standard, documented OTel Node bootstrap step that this codebase's manual (non-NodeSDK) OTel setup skipped. Root cause addressed, not a symptom patch."
  blind_spots: "Have not yet verified end-to-end against a live Langfuse project (no LANGFUSE_PUBLIC_KEY/SECRET_KEY available in this environment) — verification will rely on unit/integration-level reproduction of context propagation plus a code review that CallbackHandler's actual span-creation path (startAndRegisterOtelSpan) reads context.active() the same way propagateAttributes writes it. Also have not yet explained the SECOND symptom (zero Analyst/'analista' trace entries) — that appears to be a separate/independent issue (possibly an orchestrator routing bug that never reaches analyticsAgentNode) since analytics-agent.ts's streamWithGeneration call site is structurally identical to facilitation-agent.ts's and would still emit a (rootless, orphan) trace even with the context bug. Investigating that separately after this fix lands."

hypothesis: CONFIRMED — missing OTel ContextManager registration (NoopContextManager default) makes @langfuse/core's propagateAttributes()-based userId injection a silent no-op for every trace.
test: add otelApi.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable()) to setupLangfuseOtel() in langfuse-otel.ts; re-run the node reproduction script pattern with a registered context manager to confirm context.active().getValue(key) now returns the propagated value across the with()/await boundary.
expecting: with AsyncLocalStorageContextManager registered, the reproduction script observes the propagated value (not undefined) both inside with() and after crossing an await boundary — confirming the fix mechanism before touching production code further.
next_action: DONE — fix applied, self-verified, AND human-verified against a real Langfuse project (userId now visible on traces). Session resolved. Second symptom (zero Analyst trace entries) intentionally NOT investigated in this session — flagged as likely a separate/independent issue (possibly routing, or related to the concurrent "Rename Analista/Verificador persona" work seen on main) for a follow-up debug session if it persists.

## Fix Applied (self-verified 2026-07-18T22:20:00Z)

1. Added `@opentelemetry/context-async-hooks@2.9.0` as a dependency of apps/api (peer-compatible with installed @opentelemetry/api@1.9.1).
2. apps/api/src/lib/langfuse-otel.ts — `setupLangfuseOtel()` now calls `otelApi.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())` alongside the existing TracerProvider registration (same idempotency guard).
3. Reproduction script re-run WITH the fix applied (registering AsyncLocalStorageContextManager first): `context.active().getValue(key)` now correctly returns the propagated value both inside `with()`, after crossing an `await` boundary inside `with()`, and in a nested `setImmediate` callback — confirming AsyncLocalStorage-based propagation now works end-to-end, unlike the pre-fix reproduction (which returned `undefined` in all three cases).
4. `npx tsc --noEmit` — clean, no type errors.
5. `npx vitest run src/lib` — 24 test files / 184 tests, all pass.
6. `npx vitest run src/routes/ai.test.ts` — 2 pre-existing failures (SC-2, SC-3 — both `expected 404 to be 200`) reproduced identically on `main` BEFORE this fix (verified via `git stash`/`git stash pop`) — confirmed unrelated regressions, not introduced by this change.

## Symptoms

expected: Every Langfuse trace shows the session creator's userId (email if available, else username); Analyst persona traces appear in Langfuse alongside Coach traces (own type/name), since the Analyst responds normally in the live chat.
actual: userId is never visible on any Langfuse trace. Many trace entries exist with type/name "facilitation_coach"; zero entries exist for the Analyst ("analista") persona.
errors: None observed — no console or server errors reported. User has not checked server logs, only the Langfuse UI.
reproduction: 100% reproducible — happens in every session, for every persona (userId missing on all traces; Analyst traces absent regardless of which session is checked).
started: Never worked correctly, as far as the user has observed — not a known-good-to-bad regression they can pinpoint to a specific change.

## Eliminated

## Evidence

- timestamp: 2026-07-18T21:15:00Z
  checked: git log (prior context, not yet re-verified in this session)
  found: Commits 92e3e78 ("Add session creator to Langfuse as the tracked user (email if available, else username) for user tracking") and 5dce9ea ("wire session creator identity into Langfuse CallbackHandler userId") both touch the Langfuse userId wiring and are recent/relevant to the missing-userId symptom.
  implication: Start investigation at these commits' diffs — the userId wiring may be incomplete, conditionally skipped, or the field it's read from may be empty/undefined at runtime (e.g. session creator email/username not populated for most sessions).

- timestamp: 2026-07-18T21:40:00Z
  checked: apps/api/src/lib/langfuse-user.ts (resolveCreatorLangfuseUserId) and its call site in apps/api/src/routes/ai.ts (Step 9, CallbackHandler construction)
  found: resolveCreatorLangfuseUserId is correctly implemented (never-throw, email->full_name->creatorId fallback chain, always non-empty). ai.ts correctly awaits it and passes `userId: langfuseUserId` into `new CallbackHandler({ userId, tags })`. This matches the documented ConstructorParams type in @langfuse/langchain's index.d.ts.
  implication: The resolver and the CallbackHandler construction call site are NOT the bug — userId is a valid, non-empty string by the time it reaches CallbackHandler. The bug must be in how CallbackHandler actually attaches userId to the emitted trace/span.

- timestamp: 2026-07-18T21:45:00Z
  checked: node_modules @langfuse/langchain dist/index.mjs CallbackHandler.handleChainStart implementation
  found: userId is only attached when `!parentRunId` (root chain start only), via `propagateAttributes({ userId: traceUserId, ... }, () => { this.startAndRegisterOtelSpan(...) })` from @langfuse/tracing/@langfuse/core.
  implication: This is standard/correct behavior (root-trace-only attribution) — not itself a bug. Need to check whether propagateAttributes' context-setting mechanism actually works in this codebase's OTel bootstrap.

- timestamp: 2026-07-18T21:50:00Z
  checked: grep entire monorepo (all workspaces, apps/api/src, package.json files, pnpm-lock.yaml) for setGlobalContextManager / AsyncLocalStorageContextManager / AsyncHooksContextManager / context-async-hooks
  found: Zero matches anywhere. apps/api/src/lib/langfuse-otel.ts's setupLangfuseOtel() only calls otelApi.trace.setGlobalTracerProvider(provider) and setLangfuseTracerProvider(provider) — it never calls otelApi.context.setGlobalContextManager(...). @opentelemetry/context-async-hooks is not even installed (absent from apps/api/package.json and node_modules/.pnpm).
  implication: No OTel ContextManager is ever registered process-wide. @opentelemetry/api falls back to its built-in NoopContextManager by default.

- timestamp: 2026-07-18T21:55:00Z
  checked: node_modules/@opentelemetry/api/build/src/context/NoopContextManager.js source
  found: "with(_context, fn, thisArg, ...args) { return fn.call(thisArg, ...args); }" — the passed context argument is completely discarded, fn just runs immediately with whatever the (always-ROOT_CONTEXT) active context already is. "active() { return context_1.ROOT_CONTEXT; }" — always returns the empty root context, never anything set via with().
  implication: Any code (like @langfuse/core's propagateAttributes) that relies on context.with(ctxWithUserId, fn) to make userId observable via context.active().getValue(...) inside fn is silently a no-op under NoopContextManager.

- timestamp: 2026-07-18T22:00:00Z
  checked: Direct executable reproduction — wrote a small ESM script (run via `node` from inside apps/api so @opentelemetry/api resolves from the project's real node_modules) that does `context.with(context.active().setValue(key,'hello-userid'), () => { observed = context.active().getValue(key) })` and logs `observed` both inside the callback and after with() returns.
  found: Output was `Observed inside with(): undefined` and `Observed AFTER with() returns (outside callback): undefined` — confirms empirically, not just by reading source, that context propagation is completely broken in this codebase's current process (no context manager registered).
  implication: This is the exact mechanism @langfuse/core's propagateAttributes (used by CallbackHandler for userId/sessionId/tags on root traces) depends on. Confirms root cause directly and unambiguously — strong evidence, not inference.

- timestamp: 2026-07-18T22:05:00Z
  checked: node_modules/@langfuse/core/dist/index.mjs propagateAttributes() and setPropagatedAttribute() implementations
  found: propagateAttributes builds a new context via context.setValue(...) per attribute, then does `return otelContextApi.with(context, fn)` (the same no-op call proven above). It also attempts a same-call fallback: `const span = otelTraceApi.getActiveSpan()` captured BEFORE the new span is created, then later `if (span && span.isRecording()) { span.setAttribute(...) }` — but for a ROOT chain start (parentRunId falsy, which is precisely when CallbackHandler invokes propagateAttributes for userId), there is no pre-existing active span, so this fallback is also inert.
  implication: Confirms there is no secondary path that would still attach userId even with a broken context manager — the root cause fully explains 100% of traces missing userId, matching the reproduction's "every session, every persona" symptom.

- timestamp: 2026-07-18T22:10:00Z
  checked: npm view @opentelemetry/context-async-hooks versions/peerDependencies; tar listing of the 2.9.0 tarball
  found: @opentelemetry/context-async-hooks@2.9.0 exists, its peerDependency is `@opentelemetry/api: >=1.0.0 <1.10.0` (compatible with the installed 1.9.1), and it exports AsyncLocalStorageContextManager (build/src/AsyncLocalStorageContextManager.js/.d.ts) — the standard Node.js-recommended ContextManager implementation.
  implication: Confirms a safe, version-compatible fix path — add this package as a dependency and register AsyncLocalStorageContextManager in setupLangfuseOtel().

## Resolution

root_cause: No OpenTelemetry ContextManager was ever registered process-wide (apps/api/src/lib/langfuse-otel.ts's setupLangfuseOtel() only registers a TracerProvider, never calls context.setGlobalContextManager()). @opentelemetry/api therefore defaults to NoopContextManager, whose with(ctx, fn) discards ctx and calls fn() directly, and whose active() always returns ROOT_CONTEXT. @langfuse/core's propagateAttributes() (which CallbackHandler.handleChainStart uses to inject userId/sessionId/tags onto root traces) relies entirely on context.with(ctxWithUserId, fn) making userId observable via context.active().getValue(...) inside fn — under NoopContextManager this is a silent no-op, so userId is never attached to any trace, on every persona, every session (matches 100%-reproducible symptom). Confirmed via direct source read of NoopContextManager AND an executable reproduction script showing context.active().getValue(key) returns undefined even synchronously inside with().
fix: Add @opentelemetry/context-async-hooks as a dependency and register AsyncLocalStorageContextManager as the global OTel context manager inside setupLangfuseOtel() (apps/api/src/lib/langfuse-otel.ts), alongside the existing TracerProvider registration, guarded by the same idempotency check.
verification: Self-verified — executable reproduction confirms context propagation now works (pre-fix: undefined, post-fix: correct value, across with()/await/nested-async-callback); tsc clean; 184/184 tests pass in src/lib; 2 pre-existing unrelated test failures in ai.test.ts confirmed present on main before this change too. Human-verified 2026-07-18: user confirmed "issue 1 fixed" — userId now visible on Langfuse traces in the real Langfuse UI (live project, real LANGFUSE_PUBLIC_KEY/SECRET_KEY). Second symptom (zero Analyst trace entries) remains open and unresolved — explicitly out of scope for this session, to be tracked as a separate debug session.
files_changed:
  - apps/api/src/lib/langfuse-otel.ts (register AsyncLocalStorageContextManager as global OTel ContextManager)
  - apps/api/package.json (add @opentelemetry/context-async-hooks@2.9.0 dependency)
  - pnpm-lock.yaml (lockfile update for new dependency)
