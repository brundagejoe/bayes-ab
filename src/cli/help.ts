import { WEB_TOOL_URL } from "../core/share.ts"

export function helpText(version: string): string {
  return `bayes-ab ${version}  Bayesian A/B test analysis for humans and agents

Compares two variants of a binary outcome (signup, click, purchase) using
Beta(1,1) posteriors on each conversion rate. Reports the probability that B
beats A, the probability the lift clears a meaningful threshold, expected
loss from shipping either variant, and a forward projection of how long the
test needs to run. Same math as ${WEB_TOOL_URL}

USAGE
  bayes-ab analyze  --visitors-a N --conversions-a N --visitors-b N --conversions-b N [options]
  bayes-ab project  <analyze inputs> --daily-visitors N [--horizon DAYS] [--stop-rule RULE]
  bayes-ab plan     --baseline RATE --min-effect PCT [--daily-visitors N]
  bayes-ab schema   [analyze|project|plan]

COMMANDS
  analyze   Given what you observed, what should you do? The web tool's full readout.
  project   If traffic continues at this pace, how long until the test decides, and which way?
  plan      Before any data: how many visitors per variant to detect a given effect?
  schema    Print the JSON Schema of a command's output, for parsing ahead of time.

INPUTS (analyze, project)
  --visitors-a N, --visitors-b N       Visitors (or users, sessions) in each variant. Required.
  --conversions-a N, --conversions-b N Conversions in each variant. Required unless --rate-X is given.
  --rate-a RATE, --rate-b RATE         Use a rate instead of a count for what-if questions.
                                       Accepts 6.1%, 6.1 (percent when above 1) or 0.061 (fraction).
                                       Resolves to round(visitors × rate) conversions.
  --threshold PCT                      Decision threshold on posterior probability.   default 95
  --min-effect PCT                     Meaningful relative effect, symmetric: with 10, B must be
                                       10% better than A to count as a win or 10% worse to count
                                       as a loss. Relative, not percentage points.    default 10
  Whole numbers may include commas or underscores: 12,000 and 12_000 both work.

PROJECTION (project)
  --daily-visitors N     Visitors per day, per variant. Required.
  --horizon DAYS         How far ahead to simulate.                                default 28
  --stop-rule RULE       When a simulated future counts as decided:
                           lift         P(lift > +min-effect) or P(lift < -min-effect) reaches
                                        the threshold. Matches the web tool's decision status.
                           superiority  P(B beats A) or P(A beats B) reaches the threshold.
                                        Ignores --min-effect. Decides sooner.
                           loss         Expected loss of the better variant drops below --max-loss.
                                                                                   default lift
  --max-loss PP          Loss rule only, in percentage points of conversion rate.   default 0.01
  --simulations N        Simulated futures. More is smoother and slower.            default 2000
  Future days use a normal approximation to the posterior. Day zero is exact.

PLANNING (plan)
  --baseline RATE        Current conversion rate, e.g. 5.5% or 0.055. Required.
  --min-effect PCT       Relative change to detect. Required.
  --daily-visitors N     Converts the sample size to days.
  --power PCT            Statistical power.                                         default 80
  --alpha PCT            Two-sided significance level.                              default 5
  This is the frequentist sample-size formula, the same yardstick the web tool
  uses for its maturity bar. A planning number, not the Bayesian decision rule.

OUTPUT
  --json                 One JSON object on stdout. Default when stdout is not a terminal,
                         so piping or calling from an agent gets JSON automatically.
  --pretty               Indent the JSON.
  --brief                One-line human summary (analyze and project).
  --include-chart        Add 96 posterior density points to analyze's JSON.
  --samples N            Monte Carlo samples for intervals and loss.                default 12000
  --seed N               RNG seed. Defaults to a value derived from the inputs, so identical
                         inputs always give identical output.
  -h, --help             This text.      -v, --version   Print the version.

READING THE OUTPUT
  decision.status        ship_b | keep_a | continue | inconclusive
                         ship_b / keep_a: P(meaningful lift / harm) reached the threshold.
                         continue: not there yet and the sample is still small.
                         inconclusive: sample is large but the effect straddles the threshold.
  probability.bBeatsA    Exact closed-form P(B > A). Often high while status is still "continue",
                         because beating A is easier than beating A by --min-effect.
  expectedLoss.shipB     Average conversion-rate regret from shipping B if A is truly better.
                         A fraction: 0.00005 is 0.005 percentage points, about 0.5 conversions
                         per 10,000 visitors.
  decision.bayesActionNow  The variant with lower expected loss. Ship this if you must ship today.
  project.decisionWithinHorizon  Share of simulated futures that reach a decision by the horizon.
  project.daysToDecision  Quantiles of the decision day, among futures that decided. null if none.
  project.diagnostic     "lift_near_threshold" when the estimated lift sits on the --min-effect
                         line, which makes the lift rule slow to resolve. Try a smaller
                         --min-effect or --stop-rule superiority.
  All rates, probabilities and losses in JSON are fractions (0.0603), never percents.
  Every result includes shareUrl, the web tool with these inputs filled in.

EXAMPLES
  bayes-ab analyze --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714
  bayes-ab analyze --visitors-a 12000 --conversions-a 660 --visitors-b 10000 --rate-b 6.1% --brief
  bayes-ab analyze --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714 --json --pretty
  bayes-ab project --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714 --daily-visitors 1500
  bayes-ab project --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714 \\
                   --daily-visitors 1500 --horizon 56 --min-effect 5 --json
  bayes-ab plan --baseline 5.5% --min-effect 10 --daily-visitors 1500
  bayes-ab schema project

  Sweep a question by running several calls in parallel; JSON is one line per call:
  for d in 750 1500 3000; do
    bayes-ab project --visitors-a 12000 --conversions-a 660 --visitors-b 11850 --conversions-b 714 \\
                     --daily-visitors $d --json &
  done; wait

EXIT CODES
  0  ok        2  invalid input or unknown flag (error is JSON when output is JSON)
`
}
