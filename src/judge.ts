import type { JudgeResult, RubricScore, RunMetrics, EvalScenario } from "./types.js";
import { getSharedClient } from "./runner.js";

export interface JudgeOptions {
  model: string;
  verbose: boolean;
  timeout: number;
}

export async function judgeRun(
  scenario: EvalScenario,
  metrics: RunMetrics,
  options: JudgeOptions
): Promise<JudgeResult> {
  const rubric = scenario.rubric || [];

  try {
    const client = await getSharedClient(options.verbose);

    const session = await client.createSession({
      model: options.model,
      streaming: true,
      systemMessage: {
        mode: "replace",
        content: buildJudgeSystemPrompt(),
      },
      infiniteSessions: { enabled: false },
    });

    const userPrompt = buildJudgeUserPrompt(scenario, metrics, rubric);
    const response = await session.sendAndWait(
      { prompt: userPrompt },
      options.timeout
    );

    await session.destroy();

    if (response?.data?.content) {
      return parseJudgeResponse(String(response.data.content), rubric);
    }

    throw new Error(
      `Judge returned no content (response: ${JSON.stringify(response?.data ?? null)})`
    );
  } catch (error) {
    throw new Error(`Judge failed for "${scenario.name}": ${error}`);
  }
}

function buildJudgeSystemPrompt(): string {
  return `You are an expert evaluator assessing the quality of an AI agent's output.
You will be given:
1. The task prompt the agent was asked to perform
2. The agent's output
3. Metrics about the agent's execution (tool calls, timing, errors)
4. A rubric of criteria to evaluate

For each rubric criterion, provide an integer score from 1-5:
  1 = Very poor, criterion not met at all
  2 = Poor, significant issues
  3 = Acceptable, meets basic expectations
  4 = Good, meets expectations well
  5 = Excellent, exceeds expectations

Also provide an overall quality integer score (1-5) assessing the holistic quality, correctness, and completeness of the output.

All scores must be integers (1, 2, 3, 4, or 5). Do not use decimals.

Respond in JSON format:
{
  "rubric_scores": [
    {"criterion": "...", "score": N, "reasoning": "..."},
    ...
  ],
  "overall_score": N,
  "overall_reasoning": "..."
}

Be thorough and critical. A score of 3 is average/acceptable. Only give 5 for truly excellent work.`;
}

function buildJudgeUserPrompt(
  scenario: EvalScenario,
  metrics: RunMetrics,
  rubric: string[]
): string {
  const sections = [
    `## Task Prompt\n${scenario.prompt}`,
    `## Agent Output\n${metrics.agentOutput || "(no output)"}`,
    `## Execution Metrics
- Tool calls: ${metrics.toolCallCount}
- Tools used: ${Object.entries(metrics.toolCallBreakdown).map(([k, v]) => `${k}(${v})`).join(", ") || "none"}
- Turns: ${metrics.turnCount}
- Time: ${(metrics.wallTimeMs / 1000).toFixed(1)}s
- Errors: ${metrics.errorCount}
- Estimated tokens: ${metrics.tokenEstimate}`,
  ];

  if (rubric.length > 0) {
    sections.push(
      `## Rubric Criteria\n${rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
    );
  } else {
    sections.push(
      `## Rubric Criteria\n1. The agent completed the requested task correctly\n2. The output is clear and well-structured`
    );
  }

  return sections.join("\n\n");
}

function parseJudgeResponse(
  content: string,
  rubric: string[]
): JudgeResult {
  try {
    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallbackJudgeResult(rubric);

    const parsed = JSON.parse(jsonMatch[0]);
    const rubricScores: RubricScore[] = (parsed.rubric_scores || []).map(
      (s: { criterion: string; score: number; reasoning: string }) => ({
        criterion: s.criterion,
        score: Math.round(Math.max(1, Math.min(5, Number(s.score) || 3)) * 10) / 10,
        reasoning: s.reasoning || "",
      })
    );

    return {
      rubricScores,
      overallScore: Math.round(
        Math.max(1, Math.min(5, Number(parsed.overall_score) || 3)) * 10
      ) / 10,
      overallReasoning: parsed.overall_reasoning || "",
    };
  } catch {
    return fallbackJudgeResult(rubric);
  }
}

function fallbackJudgeResult(rubric: string[]): JudgeResult {
  const criteria =
    rubric.length > 0
      ? rubric
      : [
          "The agent completed the requested task correctly",
          "The output is clear and well-structured",
        ];

  return {
    rubricScores: criteria.map((c) => ({
      criterion: c,
      score: 3,
      reasoning: "Judge unavailable, using neutral score",
    })),
    overallScore: 3,
    overallReasoning: "Judge unavailable, using neutral score",
  };
}
