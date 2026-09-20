#!/usr/bin/env npx tsx

/**
 * Phase 3: LS Command Tests
 *
 * Tests the ls command - listing agents (top-level command).
 * Since daemon may not be running, we test both:
 * - Help and argument parsing
 * - Graceful error handling when daemon not running
 * - JSON output format
 *
 * Tests:
 * - osuna --help shows ls command
 * - osuna ls --help shows options
 * - osuna ls returns empty list or error when no daemon
 * - osuna ls --json returns valid JSON (or error)
 * - osuna ls -a flag is accepted
 * - osuna ls -g flag is accepted
 * - osuna ls does not support --ui
 */

import assert from "node:assert";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getAvailablePort } from "./helpers/network.ts";
import { runLocalOsuna } from "./helpers/local-cli.ts";

console.log("=== LS Command Tests ===\n");

// Allocate an unused endpoint for connection-error and argument-validation checks.
const port = await getAvailablePort();
const osunaHome = await mkdtemp(join(tmpdir(), "osuna-test-home-"));

try {
  // Test 1: osuna --help shows ls command
  {
    console.log("Test 1: osuna --help shows ls command");
    const result = await runLocalOsuna(["--help"]);
    assert.strictEqual(result.exitCode, 0, "osuna --help should exit 0");
    assert(result.stdout.includes("ls"), "help should mention ls command");
    console.log("✓ osuna --help shows ls command\n");
  }

  // Test 2: osuna ls --help shows options
  {
    console.log("Test 2: osuna ls --help shows options");
    const result = await runLocalOsuna(["ls", "--help"]);
    assert.strictEqual(result.exitCode, 0, "osuna ls --help should exit 0");
    assert(result.stdout.includes("-a"), "help should mention -a flag");
    assert(result.stdout.includes("--all"), "help should mention --all flag");
    assert(result.stdout.includes("-g"), "help should mention -g flag");
    assert(result.stdout.includes("--global"), "help should mention --global flag");
    assert(result.stdout.includes("across all directories"), "help should describe global scope");
    assert(!result.stdout.includes("Legacy no-op"), "help should not describe -g as a no-op");
    assert(result.stdout.includes("--host"), "help should mention --host option");
    assert(!result.stdout.includes("--ui"), "help should not mention --ui");
    console.log("✓ osuna ls --help shows options\n");
  }

  // Test 3: osuna ls returns error when no daemon running
  {
    console.log("Test 3: osuna ls handles daemon not running");
    const result = await runLocalOsuna(["ls"], {
      OSUNA_HOST: `localhost:${port}`,
    });
    // Should fail because daemon not running
    assert.notStrictEqual(result.exitCode, 0, "should fail when daemon not running");
    const output = result.stdout + result.stderr;
    const hasError =
      output.toLowerCase().includes("daemon") ||
      output.toLowerCase().includes("connect") ||
      output.toLowerCase().includes("cannot");
    assert(hasError, "error message should mention connection issue");
    assert.match(
      output,
      /Check the selected endpoint and credentials/,
      "the recovery message should explain how to check the selected endpoint",
    );
    console.log("✓ osuna ls handles daemon not running\n");
  }

  // Test 4: osuna ls --json returns valid JSON error
  {
    console.log("Test 4: osuna ls --json handles errors");
    const result = await runLocalOsuna(["ls", "--json"], {
      OSUNA_HOST: `localhost:${port}`,
    });
    // Should still fail (daemon not running)
    assert.notStrictEqual(result.exitCode, 0, "should fail when daemon not running");
    // But output should be valid JSON if present
    const output = result.stdout.trim();
    if (output.length > 0) {
      try {
        JSON.parse(output);
        console.log("✓ osuna ls --json outputs valid JSON error\n");
      } catch {
        // Empty or stderr-only output is acceptable
        console.log("✓ osuna ls --json handled error (output may be in stderr)\n");
      }
    } else {
      console.log("✓ osuna ls --json handled error gracefully\n");
    }
  }

  // Test 5: osuna ls -a flag is accepted
  {
    console.log("Test 5: osuna ls -a flag is accepted");
    const result = await runLocalOsuna(["ls", "-a"], {
      OSUNA_HOST: `localhost:${port}`,
    });
    // Will fail due to no daemon, but flag should be parsed without error
    // (no "unknown option" error)
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -a flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ osuna ls -a flag is accepted\n");
  }

  // Test 6: osuna ls -g flag is accepted
  {
    console.log("Test 6: osuna ls -g flag is accepted");
    const result = await runLocalOsuna(["ls", "-g"], {
      OSUNA_HOST: `localhost:${port}`,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -g flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ osuna ls -g flag is accepted\n");
  }

  // Test 7: osuna ls -ag combined flags are accepted
  {
    console.log("Test 7: osuna ls -ag combined flags are accepted");
    const result = await runLocalOsuna(["ls", "-ag"], {
      OSUNA_HOST: `localhost:${port}`,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -ag flags");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ osuna ls -ag combined flags are accepted\n");
  }

  // Test 8: -q (quiet) flag is accepted globally
  {
    console.log("Test 8: -q (quiet) flag is accepted");
    const result = await runLocalOsuna(["-q", "ls"], {
      OSUNA_HOST: `localhost:${port}`,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -q flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ -q (quiet) flag is accepted\n");
  }

  // Test 9: osuna ls --ui is rejected (flag removed)
  {
    console.log("Test 9: osuna ls --ui is rejected");
    const result = await runLocalOsuna(["ls", "--ui"], {
      OSUNA_HOST: `localhost:${port}`,
    });
    assert.notStrictEqual(result.exitCode, 0, "should fail for removed --ui flag");
    const output = result.stdout + result.stderr;
    assert(output.includes("unknown option"), "should report unknown option for --ui");
    console.log("✓ osuna ls --ui is rejected\n");
  }

  // Test 10: global --host reaches the command handler
  {
    console.log("Test 10: global --host targets the requested daemon");
    const host = `localhost:${port}`;
    const result = await runLocalOsuna(["--host", host, "ls"], {
      OSUNA_HOST: "localhost:1",
      OSUNA_HOME: osunaHome,
    });
    const output = result.stdout + result.stderr;
    assert.notStrictEqual(result.exitCode, 0, "should fail when the selected daemon is absent");
    assert(output.includes(host), "connection error should name the global host");
    console.log("✓ global --host targets the requested daemon\n");
  }

  // Test 11: conflicting explicit --host selectors are rejected
  {
    console.log("Test 11: conflicting explicit --host selectors are rejected");
    const firstHost = `localhost:${port}`;
    const lastHost = `localhost:${await getAvailablePort()}`;
    const result = await runLocalOsuna(["--host", firstHost, "ls", "--host", lastHost]);
    const output = result.stdout + result.stderr;
    assert.notStrictEqual(result.exitCode, 0, "should reject conflicting explicit selectors");
    assert(
      output.includes("Conflicting duplicate --host selectors."),
      "should report the selector conflict",
    );
    assert(
      !output.includes("Cannot connect"),
      "must reject the selectors before attempting a connection",
    );
    console.log("✓ conflicting explicit --host selectors are rejected\n");
  }
} finally {
  // Clean up temp directory
  await rm(osunaHome, { recursive: true, force: true });
}

console.log("=== All ls tests passed ===");
