import { describe, it, expect } from "vitest";
import { buildSessionConfig } from "../src/runner.js";
import type { SkillInfo } from "../src/types.js";

describe("buildSessionConfig", () => {
  const mockSkill: SkillInfo = {
    name: "test-skill",
    description: "A test skill",
    path: "/home/user/skills/test-skill",
    skillMdPath: "/home/user/skills/test-skill/SKILL.md",
    skillMdContent: "# Test",
    evalPath: null,
    evalConfig: null,
  };

  it("sets skillDirectories to parent of skill path", () => {
    const config = buildSessionConfig(mockSkill, "gpt-4.1");
    expect(config.skillDirectories).toEqual(["/home/user/skills"]);
  });

  it("sets empty skillDirectories when no skill", () => {
    const config = buildSessionConfig(null, "gpt-4.1");
    expect(config.skillDirectories).toEqual([]);
  });

  it("passes the model through", () => {
    const config = buildSessionConfig(mockSkill, "claude-opus-4.6");
    expect(config.model).toBe("claude-opus-4.6");
  });

  it("disables infinite sessions", () => {
    const config = buildSessionConfig(mockSkill, "gpt-4.1");
    expect(config.infiniteSessions).toEqual({ enabled: false });
  });
});
