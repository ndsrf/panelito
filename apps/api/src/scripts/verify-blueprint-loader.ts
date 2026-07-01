/**
 * verify-blueprint-loader.ts — Developer verification script for blueprint-loader.ts
 *
 * Ensure SUPABASE_DIRECT_URL is set in apps/api/.env before running.
 * Run with: cd apps/api && npx tsx --env-file .env src/scripts/verify-blueprint-loader.ts
 *
 * This script exercises loadBlueprint() against the real local Supabase instance.
 * It is for developer verification only — not part of the vitest suite.
 */

import { loadBlueprint } from "../lib/blueprint-loader";

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  // ---------------------------------------------------------------------------
  // Test A: Happy path — load the Debate/Strategy Blueprint
  // ---------------------------------------------------------------------------
  try {
    const blueprint = await loadBlueprint("debate-strategy-v1");

    // Assertions
    if (!blueprint) throw new Error("Result is null/undefined");
    if (blueprint.id !== "debate-strategy-v1")
      throw new Error(`Expected id 'debate-strategy-v1', got '${blueprint.id}'`);
    if (blueprint.canvas_view_mode !== "graph")
      throw new Error(`Expected canvas_view_mode 'graph', got '${blueprint.canvas_view_mode}'`);
    if (blueprint.node_types.length !== 4)
      throw new Error(`Expected node_types.length 4, got ${blueprint.node_types.length}`);
    if (blueprint.edge_types.length !== 4)
      throw new Error(`Expected edge_types.length 4, got ${blueprint.edge_types.length}`);
    if (blueprint.phase_sequence.length !== 3)
      throw new Error(`Expected phase_sequence.length 3, got ${blueprint.phase_sequence.length}`);
    if (!blueprint.active_persona_ids.includes("analista_cientifico"))
      throw new Error(
        `Expected active_persona_ids to include 'analista_cientifico', got ${JSON.stringify(blueprint.active_persona_ids)}`
      );

    console.log("PASS: loadBlueprint('debate-strategy-v1') returned valid Blueprint");
    passed++;
  } catch (err) {
    console.error("FAIL: Test A (happy path):", (err as Error).message);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // Test B: Not found — nonexistent blueprintId must throw "Blueprint not found:"
  // ---------------------------------------------------------------------------
  try {
    await loadBlueprint("nonexistent-blueprint");
    // If we get here, the expected error was NOT thrown
    console.error("FAIL: Test B (not found) — expected error was NOT thrown");
    failed++;
  } catch (err) {
    const message = (err as Error).message;
    if (message.startsWith("Blueprint not found:")) {
      console.log("PASS: loadBlueprint('nonexistent-blueprint') threw expected error");
      passed++;
    } else {
      console.error(`FAIL: Test B (not found) — wrong error message: ${message}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // Test C: Caching — second call must succeed (no crash; cache hit)
  // ---------------------------------------------------------------------------
  try {
    const result1 = await loadBlueprint("debate-strategy-v1");
    const result2 = await loadBlueprint("debate-strategy-v1");

    if (!result1 || !result2)
      throw new Error("One or both results are null/undefined");
    if (result1.id !== result2.id)
      throw new Error("Second call returned different id — cache not working");

    console.log("PASS: second loadBlueprint call succeeded (cache hit)");
    passed++;
  } catch (err) {
    console.error("FAIL: Test C (caching):", (err as Error).message);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // Final result
  // ---------------------------------------------------------------------------
  if (failed === 0) {
    console.log("ALL TESTS PASSED");
    process.exit(0);
  } else {
    console.error(`\n${failed} test(s) FAILED, ${passed} passed`);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("FATAL: Unexpected error in test runner:", err);
  process.exit(1);
});
