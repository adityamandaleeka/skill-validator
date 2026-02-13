import { stat } from "node:fs/promises";
import { glob } from "node:fs/promises";
import type { Assertion, AssertionResult } from "./types.js";

async function fileExistsGlob(
  pattern: string,
  workDir: string
): Promise<boolean> {
  try {
    for await (const _ of glob(pattern, { cwd: workDir })) {
      return true;
    }
    return false;
  } catch {
    // Fallback: try as literal path
    try {
      await stat(`${workDir}/${pattern}`);
      return true;
    } catch {
      return false;
    }
  }
}

export function evaluateAssertions(
  assertions: Assertion[],
  agentOutput: string,
  workDir: string
): Promise<AssertionResult[]> {
  return Promise.all(
    assertions.map((assertion) => evaluateAssertion(assertion, agentOutput, workDir))
  );
}

async function evaluateAssertion(
  assertion: Assertion,
  agentOutput: string,
  workDir: string
): Promise<AssertionResult> {
  switch (assertion.type) {
    case "file_exists": {
      const pattern = assertion.path || "";
      const exists = await fileExistsGlob(pattern, workDir);
      return {
        assertion,
        passed: exists,
        message: exists
          ? `File matching '${pattern}' found`
          : `No file matching '${pattern}' found in ${workDir}`,
      };
    }

    case "file_not_exists": {
      const pattern = assertion.path || "";
      const exists = await fileExistsGlob(pattern, workDir);
      return {
        assertion,
        passed: !exists,
        message: !exists
          ? `No file matching '${pattern}' found (expected)`
          : `File matching '${pattern}' found but should not exist`,
      };
    }

    case "output_contains": {
      const value = assertion.value || "";
      const contains = agentOutput
        .toLowerCase()
        .includes(value.toLowerCase());
      return {
        assertion,
        passed: contains,
        message: contains
          ? `Output contains '${value}'`
          : `Output does not contain '${value}'`,
      };
    }

    case "output_not_contains": {
      const value = assertion.value || "";
      const contains = agentOutput
        .toLowerCase()
        .includes(value.toLowerCase());
      return {
        assertion,
        passed: !contains,
        message: !contains
          ? `Output does not contain '${value}' (expected)`
          : `Output contains '${value}' but should not`,
      };
    }

    case "output_matches": {
      const pattern = assertion.pattern || "";
      const regex = new RegExp(pattern, "i");
      const matches = regex.test(agentOutput);
      return {
        assertion,
        passed: matches,
        message: matches
          ? `Output matches pattern '${pattern}'`
          : `Output does not match pattern '${pattern}'`,
      };
    }

    case "output_not_matches": {
      const pattern = assertion.pattern || "";
      const regex = new RegExp(pattern, "i");
      const matches = regex.test(agentOutput);
      return {
        assertion,
        passed: !matches,
        message: !matches
          ? `Output does not match pattern '${pattern}' (expected)`
          : `Output matches pattern '${pattern}' but should not`,
      };
    }

    case "exit_success": {
      // If the agent produced output without errors, consider it a success
      const success = agentOutput.length > 0;
      return {
        assertion,
        passed: success,
        message: success
          ? "Agent completed successfully"
          : "Agent produced no output",
      };
    }

    default:
      return {
        assertion,
        passed: false,
        message: `Unknown assertion type: ${(assertion as Assertion).type}`,
      };
  }
}
