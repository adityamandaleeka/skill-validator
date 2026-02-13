import { describe, it, expect } from "vitest";
import { parseEvalConfig, validateEvalConfig } from "../src/eval-schema.js";

describe("parseEvalConfig", () => {
  it("parses a valid eval config", () => {
    const config = parseEvalConfig({
      scenarios: [
        {
          name: "Test scenario",
          prompt: "Do something",
          assertions: [{ type: "output_contains", value: "hello" }],
          rubric: ["Output is correct"],
          timeout: 60,
        },
      ],
    });

    expect(config.scenarios).toHaveLength(1);
    expect(config.scenarios[0].name).toBe("Test scenario");
    expect(config.scenarios[0].timeout).toBe(60);
  });

  it("applies default timeout", () => {
    const config = parseEvalConfig({
      scenarios: [{ name: "Test", prompt: "Do it" }],
    });

    expect(config.scenarios[0].timeout).toBe(120);
  });

  it("rejects empty scenarios", () => {
    expect(() => parseEvalConfig({ scenarios: [] })).toThrow();
  });

  it("rejects missing prompt", () => {
    expect(() =>
      parseEvalConfig({ scenarios: [{ name: "Test" }] })
    ).toThrow();
  });

  it("rejects invalid assertion type", () => {
    expect(() =>
      parseEvalConfig({
        scenarios: [
          {
            name: "Test",
            prompt: "Do it",
            assertions: [{ type: "invalid_type" }],
          },
        ],
      })
    ).toThrow();
  });
});

describe("validateEvalConfig", () => {
  it("returns success for valid config", () => {
    const result = validateEvalConfig({
      scenarios: [{ name: "Test", prompt: "Do it" }],
    });
    expect(result.success).toBe(true);
  });

  it("returns errors for invalid config", () => {
    const result = validateEvalConfig({ scenarios: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
