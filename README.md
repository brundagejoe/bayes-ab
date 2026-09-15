# bayes-ab

Bayesian A/B test analysis on the command line, for humans and for agents.

It is the [Bayesian A/B Test Calculator](https://www.joebrundage.com/tools/bayesian-ab-test) as a command. Same math, same defaults, plus a forward projection that answers the question the web page cannot: **how long will this test take to decide, and which way?**

```
$ bayes-ab analyze --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714

Bayesian A/B test  Beta(1,1) prior · decision threshold 95% · meaningful effect ±10% relative

Decision            Continue test
Evidence            Low   (46% of the way to a stable estimate)
Bayes action now    Ship B   (expected regret 0.0050 pp, about 0.50 missed conversions per 10,000 visitors)

                            Variant A            Variant B
  Visitors                     12,000               11,850
  Conversions                     660                  714
  Observed rate                 5.50%                6.03%
  Posterior mean               5.507%               6.033%
  Posterior         Beta(661, 11,341)    Beta(715, 11,137)

P(B beats A)                        95.91%
P(relative lift > +10%)             46.42%
P(relative lift < -10%)             0.02%
P(B is harmful at all)              4.06%

Relative lift          +9.54%   95% CI  -1.17% to +21.30%
Absolute difference    +0.53 pp   95% CI  -0.07 pp to +1.11 pp
Observed difference    +0.53 pp   relative +9.55%

Expected loss if you ship B         0.0050 pp
Expected loss if you ship A         0.5280 pp
Two-sided p-value                   0.082   frequentist reference only
...
```

## Install

Requires Node.js 18.11 or newer. Check with `node --version`.

**Global install**, so `bayes-ab` is on your PATH:

```sh
npm install -g bayes-ab
bayes-ab --help
```

**No install**, run it straight from the registry:

```sh
npx bayes-ab analyze --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714
```

**From source**, if you are hacking on it:

```sh
git clone https://github.com/brundagejoe/bayes-ab.git
cd bayes-ab
npm install
npm run build
npm link          # puts a bayes-ab symlink on your PATH pointing at this checkout
bayes-ab --version
```

`npm link` is reversible with `npm unlink -g bayes-ab`. To upgrade a global install later, run `npm install -g bayes-ab@latest`.

If `npm install -g` fails with a permissions error on macOS or Linux, the clean fix is to point npm at a directory you own rather than using `sudo`:

```sh
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc   # or ~/.bashrc
source ~/.zshrc
npm install -g bayes-ab
```

## Commands

| Command | Question it answers |
|---|---|
| `analyze` | Given what I have observed, what should I do? The web tool's full readout. |
| `project` | If traffic continues at this pace, how long until this test decides, and which way? |
| `plan` | Before any data: how many visitors per variant do I need to detect a given effect? |
| `schema` | What fields will the JSON output contain? |

### analyze

```sh
bayes-ab analyze --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714
bayes-ab analyze --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714 --threshold 90 --min-effect 5
```

Ask a what-if by giving a rate instead of a count. The tool rounds to the nearest whole conversion and tells you what it used:

```sh
bayes-ab analyze --visitors-a 12000 --conversions-a 660 --visitors-b 10000 --rate-b 6.1% --brief
# Continue test · P(B beats A) 97.13% · P(lift > +10%) 56.76% · lift +10.92% (CI -0.30% to +23.39%) · loss if ship B 0.0034 pp  B = 610/10000 from --rate-b 6.10%
```

### project

Takes the current posterior, draws a plausible pair of true conversion rates, simulates each future day of traffic, and re-runs the decision rule after every day. Repeats that thousands of times.

```sh
bayes-ab project --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714 --daily-visitors 1500
```

```
Forward projection  1,500 visitors/day per variant · 28-day horizon · 2,000 simulated futures
Stopping rule       P(lift > +10%) ≥ 95%  or  P(lift < -10%) ≥ 95%

Chance of a decision within 28 days         20%
  Ship B                    20%
  Keep A                     0%
  Still running at day 28   80%

If it decides, when?
  25% of decisions by day    10
  50%                        14
  75%                        21
  90%                        25

Cumulative chance of a decision
  by day  7     3%
  by day 14    10%
  by day 21    16%
  by day 28    20%

Why so slow   The estimated lift sits on the ±10% meaningful-effect line.
              More data sharpens the estimate around that line instead of pushing it across.
              Try a smaller --min-effect, or --stop-rule superiority to ask only whether B beats A.
```

Three stopping rules:

- `lift` (default) matches the web tool's decision status: stop when the probability of a meaningful lift, or a meaningful loss, reaches the threshold.
- `superiority` stops when P(B beats A) or P(A beats B) reaches the threshold. Ignores `--min-effect`. Decides sooner.
- `loss` stops when the expected loss of the better variant drops below `--max-loss` (in percentage points, default 0.01).

If the rule is already met by today's data, `project` says so and skips the simulation.

### plan

```sh
bayes-ab plan --baseline 5.5% --min-effect 10 --daily-visitors 1500
```

```
Sample size plan  baseline 5.50% · detect a ±10% relative change (to 6.05% or 4.95%) · 80% power, 5% alpha

Visitors per variant         26,972
Total visitors               53,944
Days at 1,500/day/variant    18

Sensitivity
  min effect    5%   107,887 per variant   72 days
  min effect   10%    26,972 per variant   18 days   ← you are here
  min effect   15%    11,988 per variant    8 days
  min effect   20%     6,743 per variant    5 days
```

This is the frequentist sample-size formula, the same yardstick the web tool uses for its maturity bar. It is a planning number, not the Bayesian decision rule.

## Output for agents and scripts

When stdout is not a terminal, output is one JSON object on one line. `--json` forces that; `--pretty` indents it.

```sh
bayes-ab analyze --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714 --json --pretty
```

```json
{
  "tool": "bayes-ab",
  "version": "0.1.0",
  "command": "analyze",
  "inputs": { "visitorsA": 12000, "conversionsA": 660, "visitorsB": 11850, "conversionsB": 714, "threshold": 0.95, "minEffect": 0.1, "prior": [1, 1], "samples": 12000, "seed": 112396 },
  "decision": { "status": "continue", "label": "Continue test", "evidence": "low", "maturity": "building", "maturityProgress": 0.462241, "bayesActionNow": "B", "expectedRegretNow": 0.00005 },
  "probability": { "bBeatsA": 0.959114, "aBeatsB": 0.040886, "meaningfulLift": 0.464167, "meaningfulHarm": 0.000167, "harmful": 0.040583, "liftAbove1pct": 0.937833, "liftAbove5pct": 0.788417, "harmBeyond5pct": 0.00325, "harmBeyond10pct": 0.000167 },
  "effect": { "relativeLift": 0.095384, "relativeLiftCI95": [-0.011657, 0.213021], "absoluteDiff": 0.005253, "absoluteDiffCI95": [-0.000675, 0.011123], "observedRelativeLift": 0.095512, "observedAbsoluteDiff": 0.005253 },
  "expectedLoss": { "shipA": 0.00528, "shipB": 0.00005 },
  "variants": { "A": { "...": "..." }, "B": { "...": "..." } },
  "sampleSize": { "requiredPerVariant": 25636, "additionalPerVariant": 13786, "detectableEffectNow": 0.147083 },
  "waiting": [ { "extraPerVariant": 1000, "expectedRegret": 0.00006, "valueOfWaiting": 0 }, "..." ],
  "frequentist": { "pValueTwoSided": 0.081709 },
  "shareUrl": "https://www.joebrundage.com/tools/bayesian-ab-test?visitorsA=12000&conversionsA=660&visitorsB=11850&conversionsB=714&thresholdPercent=95&meaningfulLiftPercent=10"
}
```

Rules that hold everywhere:

- Rates, probabilities and losses are fractions in JSON (`0.0603`), never percent strings. Numbers are rounded to six decimals.
- `decision.status` is one of `ship_b`, `keep_a`, `continue`, `inconclusive`.
- Identical inputs give identical output. Seeds derive from the inputs; `--seed N` overrides.
- Errors are JSON on stdout when output is JSON, with exit code 2: `{"error":{"code":"invalid_input","message":"...","field":"conversions-a"}}`.
- Every analysis includes `shareUrl`, the web tool with these inputs filled in.
- `bayes-ab schema analyze` prints the JSON Schema for a command's output.

Because each call is stateless and prints one line, sweeps parallelize trivially:

```sh
for d in 750 1500 3000; do
  bayes-ab project --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714 \
                   --daily-visitors $d --json &
done; wait
```

### Giving an agent the tool

The `--help` text is written to be pasted into an agent's context. It covers every flag, how to read each output field, and worked examples. For Claude Code, Codex or similar, either of these works:

```sh
bayes-ab --help > .claude/bayes-ab-help.txt     # then reference it from CLAUDE.md
```

or add a line like this to your agent instructions:

> `bayes-ab` is installed. Run `bayes-ab --help` before using it. Use `analyze` to read a test, `project` to estimate how long it needs, and `plan` to size a new one. Prefer `--json`. Run several calls in parallel when sweeping a question.

## Using it as a library

The math is exported without the CLI:

```ts
import { analyze, project, plan } from "bayes-ab"

const result = analyze({ visitorsA: 12000, conversionsA: 660, visitorsB: 11850, conversionsB: 714 })
result.probability.bBeatsA   // 0.9591138673472563
```

## Method

- Each conversion rate gets a Beta(1,1) prior. Posteriors are Beta(1 + conversions, 1 + non-conversions).
- P(B beats A) is the exact closed form from [Evan Miller](https://www.evanmiller.org/bayesian-ab-testing.html).
- Lift intervals, threshold probabilities and expected loss come from 12,000 seeded Monte Carlo draws.
- The meaningful effect is relative and symmetric: `--min-effect 10` means B must be 10% better than A to count as a win or 10% worse to count as a loss.
- `project` samples true rates from the exact posterior, then uses a normal approximation to the posterior when re-checking the stopping rule on each simulated day. Day zero is checked exactly.

## Development

```sh
npm install
npm test            # node's built-in runner against the TypeScript source
npm run typecheck
npm run build       # bundles dist/cli.js and dist/index.js with esbuild
node dist/cli.js --help
```

Tests pin the outputs to the web tool's default example so the two never drift.

## License

MIT
