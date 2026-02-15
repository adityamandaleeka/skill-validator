import { Command } from "commander";
import chalk from "chalk";
import { discoverSkills } from "./discovery.js";
import { runAgent, stopSharedClient, getSharedClient } from "./runner.js";
import { evaluateAssertions } from "./assertions.js";
import { judgeRun } from "./judge.js";
import { compareScenario, computeVerdict } from "./comparator.js";
import { reportResults, saveRunResults } from "./reporter.js";
import type {
  ValidatorConfig,
  ReporterSpec,
  SkillVerdict,
  RunResult,
  ScenarioComparison,
} from "./types.js";
import type { ModelInfo } from "@github/copilot-sdk";

const isInteractive = process.stdout.isTTY && !process.env.CI;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private message = "";
  private active = false;

  start(message: string): void {
    this.message = message;
    this.active = true;
    if (!isInteractive) {
      process.stderr.write(`${message}\n`);
      return;
    }
    this.frame = 0;
    this.render();
    this.interval = setInterval(() => {
      this.frame++;
      this.render();
    }, 80);
  }

  update(message: string): void {
    this.message = message;
    if (!isInteractive) {
      process.stderr.write(`${message}\n`);
    }
  }

  /** Write a log line without clobbering the spinner */
  log(text: string): void {
    if (this.active && isInteractive) {
      // Clear spinner line, write log, redraw spinner
      process.stderr.write(`\r\x1b[K${text}\n`);
      this.render();
    } else {
      process.stderr.write(`${text}\n`);
    }
  }

  stop(finalMessage?: string): void {
    this.active = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (isInteractive) {
      process.stderr.write(`\r\x1b[K`);
    }
    if (finalMessage) {
      process.stderr.write(`${finalMessage}\n`);
    }
  }

  private render(): void {
    if (!isInteractive) return;
    const f = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
    process.stderr.write(`\r\x1b[K${chalk.cyan(f)} ${this.message}`);
  }
}

function parseReporter(value: string): ReporterSpec {
  const [type, outputPath] = value.split(":");
  if (type !== "console" && type !== "json" && type !== "junit") {
    throw new Error(`Unknown reporter type: ${type}`);
  }
  return { type, outputPath };
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("skill-validator")
    .description(
      "Validate that agent skills meaningfully improve agent performance"
    )
    .version("0.1.0")
    .argument("<paths...>", "Paths to skill directories or parent directories")
    .option(
      "--min-improvement <number>",
      "Minimum improvement score to pass (0-1)",
      "0.1"
    )
    .option("--require-completion", "Fail if skill regresses task completion", true)
    .option("--require-evals", "Fail if skill has no tests/eval.yaml", false)
    .option("--strict", "Strict mode: require evals and fail on any issue", false)
    .option("--verbose", "Show detailed per-scenario breakdowns", false)
    .option("--model <name>", "Model to use for agent runs", "claude-opus-4.6")
    .option("--judge-model <name>", "Model to use for judging (defaults to --model)")
    .option("--runs <number>", "Number of runs per scenario for averaging", "3")
    .option("--judge-timeout <number>", "Judge timeout in seconds", "120")
    .option(
      "--results-dir <path>",
      "Directory to save run results",
      ".skill-validator-results"
    )
    .option(
      "--reporter <spec>",
      "Reporter (console, json:path, junit:path). Can be repeated.",
      (val: string, prev: ReporterSpec[]) => [...prev, parseReporter(val)],
      [] as ReporterSpec[]
    )
    .action(async (paths: string[], opts) => {
      const config: ValidatorConfig = {
        minImprovement: parseFloat(opts.minImprovement),
        requireCompletion: opts.requireCompletion,
        requireEvals: opts.strict || opts.requireEvals,
        strict: opts.strict,
        verbose: opts.verbose,
        model: opts.model,
        judgeModel: opts.judgeModel || opts.model,
        judgeMode: opts.judgeMode || "pairwise",
        runs: parseInt(opts.runs, 10),
        judgeTimeout: parseInt(opts.judgeTimeout, 10) * 1000,
        confidenceLevel: parseFloat(opts.confidenceLevel || "0.95"),
        reporters:
          opts.reporter.length > 0
            ? opts.reporter
            : [{ type: "console" as const }],
        skillPaths: paths,
        saveResults: opts.saveResults !== false,
        resultsDir: opts.resultsDir,
      };

      const exitCode = await run(config);
      process.exit(exitCode);
    });

  return program;
}

export async function run(config: ValidatorConfig): Promise<number> {
  // Validate model early
  try {
    const client = await getSharedClient(config.verbose);
    const models: ModelInfo[] = await client.listModels();
    const modelIds = models.map((m) => m.id);
    const modelsToValidate = [config.model];
    if (config.judgeModel !== config.model) modelsToValidate.push(config.judgeModel);
    for (const m of modelsToValidate) {
      if (!modelIds.includes(m)) {
        console.error(
          `Invalid model: "${m}"\n` +
          `Available models: ${modelIds.join(", ")}`
        );
        return 1;
      }
    }
    console.log(`Using model: ${config.model}` +
      (config.judgeModel !== config.model ? `, judge: ${config.judgeModel}` : ""));
  } catch (error) {
    console.error(`Failed to validate model: ${error}`);
    return 1;
  }

  // Discover skills
  const allSkills = (
    await Promise.all(config.skillPaths.map(discoverSkills))
  ).flat();

  if (allSkills.length === 0) {
    console.error("No skills found in the specified paths.");
    return 1;
  }

  console.log(`Found ${allSkills.length} skill(s)\n`);

  const verdicts: SkillVerdict[] = [];

  for (const skill of allSkills) {
    if (!skill.evalConfig) {
      if (config.requireEvals) {
        verdicts.push({
          skillName: skill.name,
          skillPath: skill.path,
          passed: false,
          scenarios: [],
          overallImprovementScore: 0,
          reason: "No tests/eval.yaml found (required by --require-evals or --strict)",
        });
      } else {
        console.log(`⏭  Skipping ${skill.name} (no tests/eval.yaml)`);
      }
      continue;
    }

    console.log(`🔍 Evaluating ${skill.name}...`);
    const comparisons: ScenarioComparison[] = [];
    const spinner = new Spinner();
    const log = (msg: string) => spinner.log(msg);

    for (const scenario of skill.evalConfig.scenarios) {
      console.log(`   📋 Scenario: ${scenario.name}`);

      // Run N times and average, pipelining judge calls with next run
      const baselineRuns: RunResult[] = [];
      const withSkillRuns: RunResult[] = [];
      const pendingJudges: Promise<void>[] = [];

      for (let i = 0; i < config.runs; i++) {
        const runLabel = `Run ${i + 1}/${config.runs}`;
        spinner.start(`      ${runLabel}: running agents...`);

        // Run baseline and with-skill in parallel
        const [baselineMetrics, withSkillMetrics] = await Promise.all([
          runAgent({
            scenario,
            skill: null,
            model: config.model,
            verbose: config.verbose,
            log,
          }),
          runAgent({
            scenario,
            skill,
            model: config.model,
            verbose: config.verbose,
            log,
          }),
        ]);

        // Evaluate assertions for both
        if (scenario.assertions) {
          baselineMetrics.assertionResults = await evaluateAssertions(
            scenario.assertions,
            baselineMetrics.agentOutput,
            process.cwd()
          );
          baselineMetrics.taskCompleted =
            baselineMetrics.assertionResults.every((a) => a.passed);

          withSkillMetrics.assertionResults = await evaluateAssertions(
            scenario.assertions,
            withSkillMetrics.agentOutput,
            process.cwd()
          );
          withSkillMetrics.taskCompleted =
            withSkillMetrics.assertionResults.every((a) => a.passed);
        } else {
          baselineMetrics.taskCompleted = baselineMetrics.errorCount === 0;
          withSkillMetrics.taskCompleted = withSkillMetrics.errorCount === 0;
        }

        // Fire off judge calls — they run concurrently with the next iteration's agent runs
        const judgePromise = (async () => {
          const [baselineJudge, withSkillJudge] = await Promise.all([
            judgeRun(scenario, baselineMetrics, {
              model: config.judgeModel,
              verbose: config.verbose,
              timeout: config.judgeTimeout,
              workDir: baselineMetrics.workDir,
              skillPath: skill.path,
            }),
            judgeRun(scenario, withSkillMetrics, {
              model: config.judgeModel,
              verbose: config.verbose,
              timeout: config.judgeTimeout,
              workDir: withSkillMetrics.workDir,
              skillPath: skill.path,
            }),
          ]);

          baselineRuns.push({
            metrics: baselineMetrics,
            judgeResult: baselineJudge,
          });

          withSkillRuns.push({
            metrics: withSkillMetrics,
            judgeResult: withSkillJudge,
          });
        })();

        pendingJudges.push(judgePromise);
        spinner.stop(`      ✓ ${runLabel} agents complete, judging in background...`);
      }

      // Wait for all judge calls to finish
      spinner.start(`      Waiting for judges to complete...`);
      await Promise.all(pendingJudges);
      spinner.stop(`      ✓ All ${config.runs} run(s) judged`);

      // Average results across runs
      const avgBaseline = averageResults(baselineRuns);
      const avgWithSkill = averageResults(withSkillRuns);

      comparisons.push(
        compareScenario(scenario.name, avgBaseline, avgWithSkill)
      );
    }

    const verdict = computeVerdict(
      skill,
      comparisons,
      config.minImprovement,
      config.requireCompletion
    );
    verdicts.push(verdict);
  }

  await reportResults(verdicts, config.reporters, config.verbose);

  if (config.saveResults) {
    const runDir = await saveRunResults(verdicts, config.resultsDir, config.model, config.judgeModel);
    console.log(chalk.dim(`Run results saved to ${runDir}`));
  }

  await stopSharedClient();

  const allPassed = verdicts.every((v) => v.passed);
  return allPassed ? 0 : 1;
}

function averageResults(runs: RunResult[]): RunResult {
  if (runs.length === 1) return runs[0];

  const avgMetrics = {
    tokenEstimate: Math.round(avg(runs.map((r) => r.metrics.tokenEstimate))),
    toolCallCount: Math.round(avg(runs.map((r) => r.metrics.toolCallCount))),
    toolCallBreakdown: runs[0].metrics.toolCallBreakdown,
    turnCount: Math.round(avg(runs.map((r) => r.metrics.turnCount))),
    wallTimeMs: Math.round(avg(runs.map((r) => r.metrics.wallTimeMs))),
    errorCount: Math.round(avg(runs.map((r) => r.metrics.errorCount))),
    assertionResults: runs[runs.length - 1].metrics.assertionResults,
    taskCompleted: runs.some((r) => r.metrics.taskCompleted),
    agentOutput: runs[runs.length - 1].metrics.agentOutput,
    events: runs[runs.length - 1].metrics.events,
    workDir: runs[runs.length - 1].metrics.workDir,
  };

  const avgJudge = {
    rubricScores: runs[0].judgeResult.rubricScores.map((s, i) => ({
      criterion: s.criterion,
      score: round1(avg(runs.map((r) => r.judgeResult.rubricScores[i]?.score ?? 3))),
      reasoning: s.reasoning,
    })),
    overallScore: round1(avg(runs.map((r) => r.judgeResult.overallScore))),
    overallReasoning: runs[runs.length - 1].judgeResult.overallReasoning,
  };

  return { metrics: avgMetrics, judgeResult: avgJudge };
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
