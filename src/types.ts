export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  skillMdPath: string;
  skillMdContent: string;
  evalPath: string | null;
  evalConfig: EvalConfig | null;
}

export interface EvalConfig {
  scenarios: EvalScenario[];
}

export interface EvalScenario {
  name: string;
  prompt: string;
  setup?: SetupConfig;
  assertions?: Assertion[];
  rubric?: string[];
  timeout?: number;
}

export interface SetupConfig {
  files?: SetupFile[];
}

export interface SetupFile {
  path: string;
  source?: string;
  content?: string;
}

export type AssertionType =
  | "file_exists"
  | "file_not_exists"
  | "output_contains"
  | "output_not_contains"
  | "output_matches"
  | "output_not_matches"
  | "exit_success";

export interface Assertion {
  type: AssertionType;
  path?: string;
  value?: string;
  pattern?: string;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  message: string;
}

export interface RunMetrics {
  tokenEstimate: number;
  toolCallCount: number;
  toolCallBreakdown: Record<string, number>;
  turnCount: number;
  wallTimeMs: number;
  errorCount: number;
  assertionResults: AssertionResult[];
  taskCompleted: boolean;
  agentOutput: string;
  events: AgentEvent[];
  workDir: string;
}

export interface AgentEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface JudgeResult {
  rubricScores: RubricScore[];
  overallScore: number;
  overallReasoning: string;
}

export interface RubricScore {
  criterion: string;
  score: number;
  reasoning: string;
}

export interface RunResult {
  metrics: RunMetrics;
  judgeResult: JudgeResult;
}

export interface ScenarioComparison {
  scenarioName: string;
  baseline: RunResult;
  withSkill: RunResult;
  improvementScore: number;
  breakdown: MetricBreakdown;
}

export interface MetricBreakdown {
  tokenReduction: number;
  toolCallReduction: number;
  taskCompletionImprovement: number;
  timeReduction: number;
  qualityImprovement: number;
  overallJudgmentImprovement: number;
  errorReduction: number;
}

export interface SkillVerdict {
  skillName: string;
  skillPath: string;
  passed: boolean;
  scenarios: ScenarioComparison[];
  overallImprovementScore: number;
  reason: string;
}

export interface ValidatorConfig {
  minImprovement: number;
  requireCompletion: boolean;
  requireEvals: boolean;
  strict: boolean;
  verbose: boolean;
  model: string;
  judgeModel: string;
  runs: number;
  judgeTimeout: number;
  reporters: ReporterSpec[];
  skillPaths: string[];
  saveResults: boolean;
  resultsDir: string;
}

export interface ReporterSpec {
  type: "console" | "json" | "junit";
  outputPath?: string;
}

export const DEFAULT_WEIGHTS: Record<keyof MetricBreakdown, number> = {
  tokenReduction: 0.05,
  toolCallReduction: 0.025,
  taskCompletionImprovement: 0.15,
  timeReduction: 0.025,
  qualityImprovement: 0.40,
  overallJudgmentImprovement: 0.30,
  errorReduction: 0.05,
};
