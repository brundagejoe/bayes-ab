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
  prior: pair(number),
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
      harmful: { ...fraction, description: "P(relative lift < 0)" },
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
    shareUrl: { type: "string", format: "uri" },
  }, [
    "tool", "version", "command", "inputs", "decision", "probability", "effect", "expectedLoss",
    "variants", "sampleSize", "waiting", "frequentist", "shareUrl",
  ]),
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
  project: PROJECT_SCHEMA,
  plan: PLAN_SCHEMA,
  error: ERROR_SCHEMA,
}
