const fraction = { type: "number", minimum: 0, maximum: 1 }
const number = { type: "number" }
const integer = { type: "integer", minimum: 0 }
const pair = (item: object) => ({ type: "array", items: item, minItems: 2, maxItems: 2 })
const object = (properties: Record<string, object>, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const envelope = {
  tool: { const: "bayes-ab" },
  version: { type: "string" },
}

const variantInputs = {
  visitorsA: integer,
  conversionsA: integer,
  visitorsB: integer,
  conversionsB: integer,
  threshold: fraction,
  minEffect: fraction,
  prior: { ...pair({ type: "number", exclusiveMinimum: 0 }), description: "The Beta(alpha, beta) prior applied to each variant. [1, 1] unless --prior-alpha or --prior-beta was given." },
}

const derivedFrom = {
  ...object({ rateA: fraction, rateB: fraction }, []),
  description: "Present when --rate-a or --rate-b was used; the rate that produced the conversion count.",
}

export const ANALYZE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "bayes-ab analyze output",
  ...object({
    ...envelope,
    command: { const: "analyze" },
    inputs: object({ ...variantInputs, samples: integer, seed: integer, derivedFrom }, [
      ...Object.keys(variantInputs),
      "samples",
      "seed",
    ]),
    decision: object({
      status: { enum: ["ship_b", "keep_a", "continue", "inconclusive"] },
      label: { type: "string" },
      evidence: { enum: ["low", "moderate", "strong"] },
      maturity: { enum: ["early", "building", "mature"] },
      maturityProgress: fraction,
      bayesActionNow: { enum: ["A", "B"] },
      expectedRegretNow: { ...fraction, description: "Expected loss of bayesActionNow, as a conversion-rate fraction." },
    }),
    probability: object({
      bBeatsA: fraction,
      aBeatsB: fraction,
      meaningfulLift: { ...fraction, description: "P(relative lift > minEffect)" },
      meaningfulHarm: { ...fraction, description: "P(relative lift < -minEffect)" },
      harmful: { ...fraction, description: "P(B < A), the exact complement of bBeatsA" },
      liftAbove1pct: fraction,
      liftAbove5pct: fraction,
      harmBeyond5pct: fraction,
      harmBeyond10pct: fraction,
    }),
    effect: object({
      relativeLift: number,
      relativeLiftCI95: pair(number),
      absoluteDiff: number,
      absoluteDiffCI95: pair(number),
      observedRelativeLift: { type: ["number", "null"] },
      observedAbsoluteDiff: number,
      relativeLiftMedian: number,
      relativeLiftIQR: pair(number),
    }),
    expectedLoss: object({ shipA: fraction, shipB: fraction }),
    variants: object({
      A: object({ visitors: integer, conversions: integer, rate: fraction, posteriorMean: fraction, posterior: pair(number) }),
      B: object({ visitors: integer, conversions: integer, rate: fraction, posteriorMean: fraction, posterior: pair(number) }),
    }),
    sampleSize: object({
      requiredPerVariant: integer,
      additionalPerVariant: integer,
      detectableEffectNow: number,
    }),
    waiting: {
      type: "array",
      items: object({ extraPerVariant: integer, expectedRegret: fraction, valueOfWaiting: fraction }),
    },
    frequentist: object({ pValueTwoSided: fraction }),
    chart: {
      type: "array",
      description: "Only with --include-chart.",
      items: object({ rate: fraction, densityA: number, densityB: number }),
    },
    liftChart: {
      type: "array",
      description: "Only with --include-chart. Exact density of the relative lift, peak scaled to 1.",
      items: object({ relativeLift: number, density: number }),
    },
    shareUrl: { type: "string", format: "uri" },
  }, [
    "tool", "version", "command", "inputs", "decision", "probability", "effect", "expectedLoss",
    "variants", "sampleSize", "waiting", "frequentist", "shareUrl",
  ]),
}

const status = { enum: ["ship_b", "keep_a", "continue", "no_meaningful_difference"] }

export const SKEPTICAL_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "bayes-ab skeptical output",
  ...object({
    ...envelope,
    command: { const: "skeptical" },
    inputs: object(
      {
        visitorsA: integer,
        conversionsA: integer,
        visitorsB: integer,
        conversionsB: integer,
        liftPriorSd: { ...fraction, description: "Spread of true lifts, as a fraction on the log scale (about relative for small values)." },
        threshold: fraction,
        minEffect: fraction,
        maxRelativeLoss: fraction,
        derivedFrom,
      },
      ["visitorsA", "conversionsA", "visitorsB", "conversionsB", "liftPriorSd", "threshold", "minEffect", "maxRelativeLoss"]
    ),
    decision: object({
      status,
      label: { type: "string" },
      checks: object({
        bBeatsAReached: { type: "boolean" },
        aBeatsBReached: { type: "boolean" },
        shipBLossAcceptable: { type: "boolean" },
        keepALossAcceptable: { type: "boolean" },
        withinNoEffectBand: { type: "boolean", description: "95% CI inside ±minEffect and the data outweighs the prior." },
      }),
    }),
    logLift: object({ observed: number, noise: number, priorSd: number, posteriorMean: number, posteriorSd: number }),
    weights: object({
      prior: number,
      data: number,
      dataShare: fraction,
      priorEquivalentConversionsPerVariant: number,
      priorEquivalentVisitorsPerVariant: number,
    }),
    probability: object({
      bBeatsA: fraction,
      aBeatsB: fraction,
      meaningfulLift: { ...fraction, description: "P(relative lift > minEffect)" },
      meaningfulHarm: { ...fraction, description: "P(relative lift < -minEffect)" },
    }),
    effect: object({
      observedRelativeLift: { type: ["number", "null"] },
      relativeLift: { ...number, description: "Posterior median relative lift, after the prior's pull toward zero." },
      relativeLiftMean: number,
      relativeLiftCI95: pair(number),
      absoluteDiff: number,
      absoluteDiffCI95: pair(number),
    }),
    expectedLoss: object({
      shipA: { ...fraction, description: "Conversion-rate fraction." },
      shipB: { ...fraction, description: "Conversion-rate fraction." },
      shipARelative: { ...number, description: "Relative to the baseline rate." },
      shipBRelative: { ...number, description: "Relative to the baseline rate." },
    }),
    variants: object({
      A: object({ visitors: integer, conversions: integer, rate: fraction }),
      B: object({ visitors: integer, conversions: integer, rate: fraction }),
    }),
    sampleSize: object({ baselineRate: fraction, requiredPerVariant: integer, additionalPerVariant: integer, progress: fraction }),
    sensitivity: object({
      rows: { type: "array", items: object({ liftPriorSd: fraction, status, relativeLift: number, bBeatsA: fraction }) },
      robust: { type: "boolean", description: "True when half and 1.5x the prior spread give the same decision." },
    }),
    warnings: { type: "array", items: { enum: ["few_conversions", "zero_or_all_conversions", "decision_sensitive_to_prior"] } },
    approximation: { const: "normal" },
    chart: {
      type: "array",
      description: "Only with --include-chart. Prior, data and posterior densities over the relative lift, each peak scaled to 1.",
      items: object({ relativeLift: number, prior: number, data: number, posterior: number }),
    },
    shareUrl: { type: "string", format: "uri" },
  }, [
    "tool", "version", "command", "inputs", "decision", "logLift", "weights", "probability", "effect",
    "expectedLoss", "variants", "sampleSize", "sensitivity", "warnings", "approximation", "shareUrl",
  ]),
}

export const CALIBRATE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "bayes-ab calibrate output",
  ...object({
    ...envelope,
    command: { const: "calibrate" },
    inputs: object({ file: { type: "string" } }),
    tests: integer,
    liftPriorSd: { ...fraction, description: "Suggested --lift-prior-sd, as a fraction." },
    floored: { type: "boolean" },
    observedSd: number,
    typicalNoise: number,
    averageLogLift: number,
    method: { const: "dersimonian-laird" },
    warnings: { type: "array", items: { enum: ["few_tests", "no_spread_beyond_noise", "average_not_zero"] } },
    perTest: { type: "array", items: object({ relativeLift: number, logLift: number, noise: number }) },
  }),
}

export const PROJECT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "bayes-ab project output",
  ...object({
    ...envelope,
    command: { const: "project" },
    inputs: object(
      {
        ...variantInputs,
        dailyVisitors: integer,
        horizonDays: integer,
        stopRule: { enum: ["lift", "superiority", "loss"] },
        maxLoss: { type: ["number", "null"], description: "Only set for the loss rule, as a fraction." },
        simulations: integer,
        seed: integer,
        derivedFrom,
      },
      [...Object.keys(variantInputs), "dailyVisitors", "horizonDays", "stopRule", "maxLoss", "simulations", "seed"]
    ),
    alreadyDecided: { type: "boolean", description: "True when the stop rule is already met today; no simulation was run." },
    decisionNow: { enum: ["ship_b", "keep_a", null] },
    decisionWithinHorizon: fraction,
    outcomes: object({ shipB: fraction, keepA: fraction, undecided: fraction }),
    daysToDecision: {
      oneOf: [object({ p25: number, p50: number, p75: number, p90: number }), { type: "null" }],
      description: "Quantiles of the decision day among futures that decided. Conditional on deciding.",
    },
    cumulative: { type: "array", items: object({ day: integer, p: fraction }) },
    diagnostic: { enum: ["lift_near_threshold", null] },
    approximation: { const: "normal" },
    shareUrl: { type: "string", format: "uri" },
  }),
}

export const PLAN_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "bayes-ab plan output",
  ...object({
    ...envelope,
    command: { const: "plan" },
    inputs: object({
      baseline: fraction,
      minEffect: fraction,
      power: fraction,
      alpha: fraction,
      dailyVisitors: { type: ["integer", "null"] },
    }),
    targetRates: object({ up: fraction, down: fraction }),
    perVariant: integer,
    total: integer,
    days: { type: ["integer", "null"] },
    sensitivity: {
      type: "array",
      items: object({ minEffect: fraction, perVariant: integer, days: { type: ["integer", "null"] } }),
    },
  }),
}

export const ERROR_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "bayes-ab error output",
  ...object({
    error: object({
      code: { type: "string" },
      message: { type: "string" },
      field: { type: ["string", "null"], description: "The flag at fault, without leading dashes." },
    }),
  }),
}

export const SCHEMAS = {
  analyze: ANALYZE_SCHEMA,
  skeptical: SKEPTICAL_SCHEMA,
  project: PROJECT_SCHEMA,
  plan: PLAN_SCHEMA,
  calibrate: CALIBRATE_SCHEMA,
  error: ERROR_SCHEMA,
}
