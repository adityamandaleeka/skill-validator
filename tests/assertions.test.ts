import { describe, it, expect } from "vitest";
import { evaluateAssertions } from "../src/assertions.js";
import type { Assertion } from "../src/types.js";

describe("evaluateAssertions", () => {
  const workDir = "/tmp/test-workdir";

  it("output_contains passes when value is present", async () => {
    const assertions: Assertion[] = [
      { type: "output_contains", value: "hello" },
    ];
    const results = await evaluateAssertions(assertions, "hello world", workDir);
    expect(results[0].passed).toBe(true);
  });

  it("output_contains is case-insensitive", async () => {
    const assertions: Assertion[] = [
      { type: "output_contains", value: "Hello" },
    ];
    const results = await evaluateAssertions(assertions, "HELLO WORLD", workDir);
    expect(results[0].passed).toBe(true);
  });

  it("output_contains fails when value is missing", async () => {
    const assertions: Assertion[] = [
      { type: "output_contains", value: "missing" },
    ];
    const results = await evaluateAssertions(assertions, "hello world", workDir);
    expect(results[0].passed).toBe(false);
  });

  it("output_matches passes when pattern matches", async () => {
    const assertions: Assertion[] = [
      { type: "output_matches", pattern: "\\d{3}-\\d{4}" },
    ];
    const results = await evaluateAssertions(
      assertions,
      "Call 555-1234",
      workDir
    );
    expect(results[0].passed).toBe(true);
  });

  it("output_matches fails when pattern doesn't match", async () => {
    const assertions: Assertion[] = [
      { type: "output_matches", pattern: "^exact$" },
    ];
    const results = await evaluateAssertions(
      assertions,
      "not exact match",
      workDir
    );
    expect(results[0].passed).toBe(false);
  });

  it("exit_success passes with non-empty output", async () => {
    const assertions: Assertion[] = [{ type: "exit_success" }];
    const results = await evaluateAssertions(
      assertions,
      "some output",
      workDir
    );
    expect(results[0].passed).toBe(true);
  });

  it("exit_success fails with empty output", async () => {
    const assertions: Assertion[] = [{ type: "exit_success" }];
    const results = await evaluateAssertions(assertions, "", workDir);
    expect(results[0].passed).toBe(false);
  });

  it("handles multiple assertions", async () => {
    const assertions: Assertion[] = [
      { type: "output_contains", value: "hello" },
      { type: "output_contains", value: "world" },
      { type: "output_contains", value: "missing" },
    ];
    const results = await evaluateAssertions(
      assertions,
      "hello world",
      workDir
    );
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(true);
    expect(results[2].passed).toBe(false);
  });
});
