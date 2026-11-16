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
P(B is harmful at all)              4.09%

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
| `skeptical` | The same question, assuming most tests do little: the prior goes on the lift, so a small, noisy sample cannot claim a big win. |
| `calibrate` | From my past tests, how big are real lifts? Suggests the `skeptical` prior. |
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

Choose a prior. Every analysis defaults to a flat Beta(1,1) on each conversion rate; `--prior-alpha` and `--prior-beta` replace it, the same prior for both variants. Beta(α, β) reads as α conversions in α + β visitors of evidence you already had, so a prior worth 1,000 visitors centred on 5.5% is Beta(55, 945). Fractional values work, e.g. the Jeffreys prior Beta(0.5, 0.5):

```sh
bayes-ab analyze --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714 --prior-alpha 55 --prior-beta 945
```

A shared prior pulls both arms toward the same rate, so a strong one shrinks the estimated lift and makes decisions more conservative.

### skeptical

`analyze` puts a Beta prior on each variant's rate. That says each rate is probably near some baseline, but nothing about how close the two rates are to each other, so on small samples noise passes straight through as a large lift. When most of your tests do little, the "95%" calls on small samples come out right far less often than 95% of the time, and the lifts they report are inflated.

`skeptical` puts the prior on the lift itself: the log lift ln(rate B / rate A) is Normal(0, `--lift-prior-sd`), 4% by default, which says most true lifts fall within about ±8%. The posterior is a weighted average of zero and the observed lift, with each weighted by 1 / noise², so everything is closed form and can be checked by hand.

```sh
bayes-ab skeptical --visitors-a 10000 --conversions-a 200 --visitors-b 10000 --conversions-b 230
```

```
Skeptical A/B test  lift prior Normal(0, 4.0%) · threshold 95% · max loss 0.10% relative · no-effect band ±5%

Decision            Continue test
  P(B beats A) ≥ 95%                no
  Loss if ship B ≤ 0.10%            no
  ...

How the prior pulled the estimate
  Observed lift           +15.00%   ± 9.6% noise
  Estimated lift          +2.10%   95% CI  -5.02% to +9.76%
  Weight on the data      15%   the rest pulls toward 0
  Prior is worth          1,250 conversions   about 62,500 visitors per variant
  ...

Sensitivity  same data, different lift priors
  Prior spread    Estimated lift    P(B beats A)         Decision
  ±2.0%                   +0.59%          61.76%    Continue test
  ±4.0%                   +2.10%          71.36%    Continue test
  ±6.0%                   +4.03%          78.13%    Continue test
```

The decision has two conditions per side, and the readout shows each one:

- `ship_b` when P(B beats A) reaches `--threshold` **and** the expected loss of shipping B is at most `--max-relative-loss` (0.1% of the baseline rate by default). The second condition is what "make sure it is not worse" means in numbers.
- `keep_a`, the same for A.
- `no_meaningful_difference` when the 95% interval sits inside ±`--min-effect` (5% by default) and the data, not the prior, carries most of the weight.
- `continue` otherwise.

Sensitivity reruns the analysis at half and one and a half times the prior spread. If the decision changes, the readout says the data has not settled it yet.

It uses the normal approximation to the binomial, which is good from about 30 conversions per variant; below that the readout warns.

### calibrate

The prior spread is a belief about your own tests, so the best source for it is your own tests. Put past results in a CSV, one test per line:

```csv
visitorsA,conversionsA,visitorsB,conversionsB
50000,1000,50000,1080
50000,1000,50000,960
"120,000",2400,"120,000",2470
```

```sh
bayes-ab calibrate --file past-tests.csv
```

Past lifts vary for two reasons: real differences between tests, and noise within each. `calibrate` subtracts the second from the first (the DerSimonian-Laird estimator from meta-analysis) and suggests the result as `--lift-prior-sd`. It needs at least 3 tests and warns below 10.

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
  "version": "0.3.0",
  "command": "analyze",
  "inputs": { "visitorsA": 12000, "conversionsA": 660, "visitorsB": 11850, "conversionsB": 714, "threshold": 0.95, "minEffect": 0.1, "prior": [1, 1], "samples": 12000, "seed": 116218 },
  "decision": { "status": "continue", "label": "Continue test", "evidence": "low", "maturity": "building", "maturityProgress": 0.462241, "bayesActionNow": "B", "expectedRegretNow": 0.00005 },
  "probability": { "bBeatsA": 0.959114, "aBeatsB": 0.040886, "meaningfulLift": 0.464167, "meaningfulHarm": 0.000167, "harmful": 0.040886, "liftAbove1pct": 0.937833, "liftAbove5pct": 0.788417, "harmBeyond5pct": 0.00325, "harmBeyond10pct": 0.000167 },
  "effect": { "relativeLift": 0.095384, "relativeLiftCI95": [-0.011657, 0.213021], "absoluteDiff": 0.005253, "absoluteDiffCI95": [-0.000675, 0.011123], "observedRelativeLift": 0.095512, "observedAbsoluteDiff": 0.005253, "relativeLiftMedian": 0.095267, "relativeLiftIQR": [0.056954, 0.134715] },
  "expectedLoss": { "shipA": 0.00528, "shipB": 0.00005 },
  "variants": { "A": { "...": "..." }, "B": { "...": "..." } },
  "sampleSize": { "requiredPerVariant": 25636, "additionalPerVariant": 13786, "detectableEffectNow": 0.147083 },
  "waiting": [ { "extraPerVariant": 1000, "expectedRegret": 0.000048, "valueOfWaiting": 0.000002 }, "..." ],
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
import { analyze, analyzeSkeptical, calibrateLiftPrior, project, plan } from "bayes-ab"

const result = analyze({ visitorsA: 12000, conversionsA: 660, visitorsB: 11850, conversionsB: 714 })
result.probability.bBeatsA   // 0.9591138673472563

analyze({ visitorsA: 12000, conversionsA: 660, visitorsB: 11850, conversionsB: 714, prior: [55, 945] })
```

`analyzeSkeptical({ visitorsA, conversionsA, visitorsB, conversionsB, liftPriorSd, threshold, minEffect, maxRelativeLoss, includeChart })` is the `skeptical` command. With `includeChart: true` it adds `chart`: the prior, data and posterior densities over the relative lift, each peak scaled to 1. `calibrateLiftPrior(pastTests)` and `parsePastTestsCsv(text)` are the `calibrate` command.

`analyze` and `project` take an optional `prior: [alpha, beta]`, default `[1, 1]`. Non-positive values throw a `RangeError`; `validatePrior` and `isDefaultPrior` are exported for forms that want to check first.

`analyze({ ..., includeChart: true })` adds `chart` (both posterior densities) and `liftChart` (the exact density of the relative lift, peak scaled to 1), which is what the web tool plots.

The primitives behind it are exported too, for anything that needs the same math without a full analysis:

| Export | What it does |
|---|---|
| `betaPdf(x, alpha, beta)`, `logBeta`, `logGamma` | Beta density and its log-gamma building blocks |
| `probabilityBBeatsA(alphaA, betaA, alphaB, betaB)` | P(B > A) for two Beta posteriors: exact closed form for whole-number alphas, numerical integration otherwise |
| `regularizedIncompleteBeta(x, a, b)` | The Beta(a, b) CDF at x |
| `integratedExpectedLoss(alphaA, betaA, alphaB, betaB)` | Expected loss of shipping each variant by numerical integration, no sampling |
| `liftDensity(alphaA, betaA, alphaB, betaB, sortedLifts)` | Exact relative-lift density over the range the sorted lifts span |

This package is the source of truth for the math on joebrundage.com: the [calculator](https://www.joebrundage.com/tools/bayesian-ab-test) and the [primer](https://www.joebrundage.com/tools/bayesian-ab-testing-primer) both import it. Change the math here, publish, and bump the site's dependency.

## Method

- Each conversion rate gets a Beta(α, β) prior, Beta(1,1) unless you choose another. Posteriors are Beta(α + conversions, β + non-conversions).
- P(B beats A) is the exact closed form from [Evan Miller](https://www.evanmiller.org/bayesian-ab-testing.html) when α is a whole number. For a fractional α it is integrated numerically (tanh-sinh quadrature over the incomplete beta function), accurate to about 1e-10. P(B is harmful) is its exact complement.
- Lift intervals, threshold probabilities and expected loss come from 12,000 seeded Monte Carlo draws.
- The meaningful effect is relative and symmetric: `--min-effect 10` means B must be 10% better than A to count as a win or 10% worse to count as a loss.
- `skeptical` works on the log lift L = ln(rate B / rate A). The observed L has noise² = 1/cA − 1/nA + 1/cB − 1/nB (the delta method). With the prior L ~ Normal(0, σ²), the posterior is Normal with precision 1/σ² + 1/noise² and mean (1/noise²) × observed L / precision. Probabilities, intervals and expected losses are closed form on that posterior; expected losses use the log-normal partial expectation. A variant with 0 conversions (or all) gets half a conversion added.
- `calibrate` estimates σ with the DerSimonian-Laird random-effects estimator, floored at 0.5%.
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
