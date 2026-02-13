# skill-validator

Validate that agent skills ([agentskills.io](https://agentskills.io/specification)) meaningfully improve agent performance. Runs an agent with and without each skill, compares metrics, and produces a pass/fail verdict.

## How it works

1. Discovers skills (directories with `SKILL.md`)
2. Reads evaluation scenarios from each skill's `tests/eval.yaml`
3. For each scenario, runs the agent **without** the skill (baseline) and **with** the skill
4. Collects metrics: token usage, tool calls, time, errors, task completion
5. Uses LLM-as-judge to score output quality (rubric + holistic assessment)
6. Compares results and produces a verdict: does the skill actually help?

## Install

```bash
npm install
npm run build
```

## Usage

```bash
# Validate all skills in a directory
npx tsx src/index.ts ./path/to/skills/

# Validate a single skill
npx tsx src/index.ts ./path/to/my-skill/

# Verbose output with per-scenario breakdowns
npx tsx src/index.ts --verbose ./skills/

# Custom model and threshold
npx tsx src/index.ts --model claude-sonnet-4.5 --min-improvement 0.2 ./skills/

# Output as JSON or JUnit XML
npx tsx src/index.ts --reporter json:results.json ./skills/
npx tsx src/index.ts --reporter junit:results.xml ./skills/

# Strict mode (require all skills to have evals)
npx tsx src/index.ts --strict ./skills/
```

## Writing eval files

Each skill can include a `tests/eval.yaml`:

```yaml
scenarios:
  - name: "Descriptive name of the scenario"
    prompt: "The prompt to send to the agent"
    setup:
      files:
        - path: "input.txt"
          content: "file content to create before the run"
        - path: "data.csv"
          source: "fixtures/sample-data.csv"  # relative to skill dir
    assertions:
      - type: "output_contains"
        value: "expected text"
      - type: "output_matches"
        pattern: "regex pattern"
      - type: "file_exists"
        path: "*.csv"
      - type: "exit_success"
    rubric:
      - "The output is well-formatted and clear"
      - "The agent correctly handled edge cases"
    timeout: 120
```

### Assertion types

| Type | Description |
|------|-------------|
| `output_contains` | Agent output contains `value` (case-insensitive) |
| `output_matches` | Agent output matches `pattern` (regex) |
| `file_exists` | File matching `path` glob exists in work dir |
| `exit_success` | Agent produced non-empty output |

### Rubric

Rubric items are scored 1–5 by an LLM judge. The judge also provides a holistic quality score. These are the strongest signals in the improvement score (0.45 combined weight).

## Metrics & scoring

The improvement score is a weighted sum:

| Metric | Weight | What it measures |
|--------|--------|------------------|
| Token reduction | 0.10 | Fewer tokens = more efficient |
| Tool call reduction | 0.10 | Fewer tool calls = more efficient |
| Task completion | 0.20 | Did hard assertions pass? |
| Time reduction | 0.05 | Faster completion |
| Quality (rubric) | 0.30 | LLM judge rubric scores |
| Quality (overall) | 0.15 | LLM judge holistic assessment |
| Error reduction | 0.10 | Fewer errors/retries |

A skill **passes** if its average improvement score across scenarios meets the threshold (default 10%).

## CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--min-improvement <n>` | `0.1` | Minimum improvement score (0–1) |
| `--require-completion` | `true` | Fail if skill regresses task completion |
| `--require-evals` | `false` | Fail if skill has no tests/eval.yaml |
| `--strict` | `false` | Enable --require-evals and strict checking |
| `--verbose` | `false` | Show per-scenario metric breakdowns |
| `--model <name>` | `gpt-4.1` | Model for agent runs and judging |
| `--runs <n>` | `3` | Runs per scenario (averaged for stability) |
| `--reporter <spec>` | `console` | Output format: `console`, `json:path`, `junit:path` |

## CI integration

The same CLI works in CI — `--strict` makes it fail on any issue:

```yaml
name: Validate Skill Value
on:
  pull_request:
    paths: ['**/SKILL.md', '**/tests/eval.yaml']
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npx skill-validator --strict --require-evals .
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Development

```bash
npm test          # Run unit tests
npm run test:watch # Watch mode
npm run lint      # Type check
npm run build     # Compile TypeScript
```
