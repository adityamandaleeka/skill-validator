import type {
  RunResult,
  ScenarioComparison,
  MetricBreakdown,
  SkillVerdict,
  SkillInfo,
  DEFAULT_WEIGHTS,
} from "./types.js";
import { DEFAULT_WEIGHTS as WEIGHTS } from "./types.js";

function computeReduction(baseline: number, withSkill: number): number {
  if (baseline === 0) return withSkill === 0 ? 0 : -1;
  return Math.max(-1, Math.min(1, (baseline - withSkill) / baseline));
}

function averageRubricScore(result: RunResult): number {
  const scores = result.judgeResult.rubricScores;
  if (scores.length === 0) return 3;
  return scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
}

function normalizeScoreImprovement(
  baseline: number,
  withSkill: number,
  scale: number = 2.5
): number {
  // Normalize score improvement to [-1, 1] range using a tighter scale
  // so that meaningful quality differences (e.g., 4→5) have real impact
  return Math.max(-1, Math.min(1, (withSkill - baseline) / scale));
}

export function compareScenario(
  scenarioName: string,
  baseline: RunResult,
  withSkill: RunResult
): ScenarioComparison {
  const breakdown: MetricBreakdown = {
    tokenReduction: computeReduction(
      baseline.metrics.tokenEstimate,
      withSkill.metrics.tokenEstimate
    ),
    toolCallReduction: computeReduction(
      baseline.metrics.toolCallCount,
      withSkill.metrics.toolCallCount
    ),
    taskCompletionImprovement:
      withSkill.metrics.taskCompleted === baseline.metrics.taskCompleted
        ? 0
        : withSkill.metrics.taskCompleted
          ? 1
          : -1,
    timeReduction: computeReduction(
      baseline.metrics.wallTimeMs,
      withSkill.metrics.wallTimeMs
    ),
    qualityImprovement: normalizeScoreImprovement(
      averageRubricScore(baseline),
      averageRubricScore(withSkill)
    ),
    overallJudgmentImprovement: normalizeScoreImprovement(
      baseline.judgeResult.overallScore,
      withSkill.judgeResult.overallScore
    ),
    errorReduction: computeReduction(
      baseline.metrics.errorCount,
      withSkill.metrics.errorCount
    ),
  };

  let improvementScore = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const value = breakdown[key as keyof MetricBreakdown];
    improvementScore += value * weight;
  }

  return {
    scenarioName,
    baseline,
    withSkill,
    improvementScore,
    breakdown,
  };
}

export function computeVerdict(
  skill: SkillInfo,
  comparisons: ScenarioComparison[],
  minImprovement: number,
  requireCompletion: boolean
): SkillVerdict {
  if (comparisons.length === 0) {
    return {
      skillName: skill.name,
      skillPath: skill.path,
      passed: false,
      scenarios: [],
      overallImprovementScore: 0,
      reason: "No scenarios to evaluate",
    };
  }

  const overallImprovementScore =
    comparisons.reduce((sum, c) => sum + c.improvementScore, 0) /
    comparisons.length;

  // Check for task completion regression
  if (requireCompletion) {
    const regressed = comparisons.some(
      (c) => c.baseline.metrics.taskCompleted && !c.withSkill.metrics.taskCompleted
    );
    if (regressed) {
      return {
        skillName: skill.name,
        skillPath: skill.path,
        passed: false,
        scenarios: comparisons,
        overallImprovementScore,
        reason: "Skill regressed on task completion in one or more scenarios",
      };
    }
  }

  const passed = overallImprovementScore >= minImprovement;

  return {
    skillName: skill.name,
    skillPath: skill.path,
    passed,
    scenarios: comparisons,
    overallImprovementScore,
    reason: passed
      ? `Improvement score ${(overallImprovementScore * 100).toFixed(1)}% meets threshold of ${(minImprovement * 100).toFixed(1)}%`
      : `Improvement score ${(overallImprovementScore * 100).toFixed(1)}% below threshold of ${(minImprovement * 100).toFixed(1)}%`,
  };
}
