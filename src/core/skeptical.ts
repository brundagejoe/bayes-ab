import { clamp, inverseNormalCdf, normalCdf } from "./math.ts"
import { requiredSamplePerVariant } from "./plan.ts"
import { DEFAULT_THRESHOLD } from "./analyze.ts"

/*
 * The skeptical model puts the prior on the lift itself rather than on each
 * variant's rate. A Beta prior per variant says each rate is probably near the
 * baseline but says nothing about how close the two rates are to each other,
 * so on small samples it lets noise through as large lifts. Here:
 *
 *   L = ln(rate B / rate A)              the log lift; e^L - 1 is the relative lift
 *   L ~ Normal(0, liftPriorSd^2)         "most tests do little"
 *   observed L ~ Normal(L, noise^2)      noise^2 = 1/cA - 1/nA + 1/cB - 1/nB
 *
 * The posterior is Normal, a precision-weighted average of 0 and the observed
 * log lift, so everything below is closed form. It is the normal approximation
 * to the binomial, good once each arm has a few dozen conversions; below
 * MIN_RELIABLE_CONVERSIONS the result carries a warning.
 */

export const DEFAULT_LIFT_PRIOR_SD = 0.04
export const DEFAULT_SKEPTICAL_MIN_EFFECT = 0.05
export const DEFAULT_MAX_RELATIVE_LOSS = 0.001
export const MIN_RELIABLE_CONVERSIONS = 30
export const SKEPTICAL_WEB_TOOL_URL = "https://www.joebrundage.com/tools/skeptical-ab-test"

const CHART_POINTS = 121
const CI_Z = inverseNormalCdf(0.975)
const SENSITIVITY_FACTORS = [0.5, 1, 1.5]
const MIN_CALIBRATED_SD = 0.005

export type SkepticalStatus = "ship_b" | "keep_a" | "continue" | "no_meaningful_difference"

export const SKEPTICAL_LABELS: Record<SkepticalStatus, string> = {
  ship_b: "Ship Variant B",
  keep_a: "Keep Variant A",
  continue: "Continue test",
  no_meaningful_difference: "No meaningful difference",
}

export type SkepticalWarning = "few_conversions" | "zero_or_all_conversions" | "decision_sensitive_to_prior"

export type SkepticalInputs = {
  visitorsA: number
  conversionsA: number
  visitorsB: number
  conversionsB: number
  /** Spread of true relative lifts across tests, as a fraction: 0.04 means most real lifts fall within about ±8%. */
  liftPriorSd?: number
  /** Posterior probability that B (or A) is better before the decision calls it. */
  threshold?: number
  /** Relative effect that counts as meaningful, symmetric. Also the band for "no meaningful difference". */
  minEffect?: number
  /** Largest expected loss you accept when shipping, relative to the baseline rate: 0.001 is 0.1%. */
  maxRelativeLoss?: number
  includeChart?: boolean
}

export type SkepticalChartPoint = {
  relativeLift: number
  prior: number
  data: number
  posterior: number
}

export type SkepticalSensitivityRow = {
  liftPriorSd: number
  status: SkepticalStatus
  relativeLift: number
  bBeatsA: number
}

export type SkepticalResult = {
  inputs: {
    visitorsA: number
    conversionsA: number
    visitorsB: number
    conversionsB: number
    liftPriorSd: number
    threshold: number
    minEffect: number
    maxRelativeLoss: number
  }
  decision: {
    status: SkepticalStatus
    label: string
    /** Each condition the ship or keep rule checks, so a reader can see which one is holding the decision back. */
    checks: {
      bBeatsAReached: boolean
      aBeatsBReached: boolean
      shipBLossAcceptable: boolean
      keepALossAcceptable: boolean
      withinNoEffectBand: boolean
    }
  }
  /** Everything on the log-lift scale, for anyone redoing the arithmetic by hand. */
  logLift: {
    observed: number
    noise: number
    priorSd: number
    posteriorMean: number
    posteriorSd: number
  }
  weights: {
    prior: number
    data: number
    /** Share of the posterior that comes from the data, 0 to 1. The rest is the prior pulling toward zero. */
    dataShare: number
    /** Conversions per variant that would carry the same weight as the prior. */
    priorEquivalentConversionsPerVariant: number
    /** The same, in visitors per variant at the baseline rate. */
    priorEquivalentVisitorsPerVariant: number
  }
  probability: {
    bBeatsA: number
    aBeatsB: number
    meaningfulLift: number
    meaningfulHarm: number
  }
  effect: {
    observedRelativeLift: number | null
    /** Posterior median of the relative lift: the estimate after the prior's pull. */
    relativeLift: number
    relativeLiftMean: number
    relativeLiftCI95: [number, number]
    absoluteDiff: number
    absoluteDiffCI95: [number, number]
  }
  expectedLoss: {
    shipA: number
    shipB: number
    shipARelative: number
    shipBRelative: number
  }
  variants: {
    A: { visitors: number; conversions: number; rate: number }
    B: { visitors: number; conversions: number; rate: number }
  }
  sampleSize: {
    baselineRate: number
    /** Frequentist planning yardstick for detecting ±minEffect at 80% power, as in `plan`. */
    requiredPerVariant: number
    additionalPerVariant: number
    progress: number
  }
  sensitivity: {
    rows: SkepticalSensitivityRow[]
    robust: boolean
  }
  warnings: SkepticalWarning[]
  approximation: "normal"
  chart?: SkepticalChartPoint[]
  shareUrl: string
}

type Core = {
  observed: number
  noise: number
  posteriorMean: number
  posteriorSd: number
  priorWeight: number
  dataWeight: number
  bBeatsA: number
  meaningfulLift: number
  meaningfulHarm: number
  lossShipBRelative: number
  lossShipARelative: number
  status: SkepticalStatus
  checks: SkepticalResult["decision"]["checks"]
}

function validateFraction(name: string, value: number, { min, max, inclusiveMin = false }: { min: number; max: number; inclusiveMin?: boolean }): void {
  const lowOk = inclusiveMin ? value >= min : value > min
  if (!Number.isFinite(value) || !lowOk || value >= max) {
    throw new RangeError(`${name} must be ${inclusiveMin ? "at least" : "greater than"} ${min} and less than ${max}, got ${value}.`)
  }
}

function validateCounts(visitors: number, conversions: number, letter: string): void {
  if (!Number.isSafeInteger(visitors) || visitors < 1) throw new RangeError(`Visitors ${letter} must be a whole number of at least 1.`)
  if (!Number.isSafeInteger(conversions) || conversions < 0) throw new RangeError(`Conversions ${letter} must be a whole number of at least 0.`)
  if (conversions > visitors) throw new RangeError(`Conversions ${letter} cannot exceed visitors ${letter}.`)
}

/** Adds half a conversion when a count is 0 or equals visitors, so the log and its variance stay finite. */
function smoothed(visitors: number, conversions: number): { c: number; n: number; adjusted: boolean } {
  if (conversions === 0 || conversions === visitors) return { c: conversions + 0.5, n: visitors + 1, adjusted: true }
  return { c: conversions, n: visitors, adjusted: false }
}

/** Observed log lift and its noise (standard error), from the delta method. */
export function observedLogLift(visitorsA: number, conversionsA: number, visitorsB: number, conversionsB: number): { logLift: number; noise: number; adjusted: boolean } {
  const a = smoothed(visitorsA, conversionsA)
  const b = smoothed(visitorsB, conversionsB)
  const logLift = Math.log(b.c / b.n) - Math.log(a.c / a.n)
  const variance = 1 / a.c - 1 / a.n + 1 / b.c - 1 / b.n
  return { logLift, noise: Math.sqrt(variance), adjusted: a.adjusted || b.adjusted }
}

/** E[max(0, 1 - e^L)] for L ~ N(m, s^2): the relative loss from shipping B when it is worse. */
function relativeLossShipB(m: number, s: number): number {
  return Math.max(0, normalCdf(-m / s) - Math.exp(m + (s * s) / 2) * normalCdf(-m / s - s))
}

/** E[max(0, e^L - 1)] for L ~ N(m, s^2): the relative gain forgone by keeping A when B is better. */
function relativeLossShipA(m: number, s: number): number {
  return Math.max(0, Math.exp(m + (s * s) / 2) * normalCdf(m / s + s) - normalCdf(m / s))
}

function core(observed: number, noise: number, priorSd: number, threshold: number, minEffect: number, maxRelativeLoss: number): Core {
  const priorWeight = 1 / (priorSd * priorSd)
  const dataWeight = 1 / (noise * noise)
  const posteriorVariance = 1 / (priorWeight + dataWeight)
  const posteriorMean = posteriorVariance * dataWeight * observed
  const posteriorSd = Math.sqrt(posteriorVariance)

  const bBeatsA = normalCdf(posteriorMean / posteriorSd)
  const upper = Math.log(1 + minEffect)
  const lower = Math.log(1 - minEffect)
  const meaningfulLift = 1 - normalCdf((upper - posteriorMean) / posteriorSd)
  const meaningfulHarm = normalCdf((lower - posteriorMean) / posteriorSd)
  const lossShipBRelative = relativeLossShipB(posteriorMean, posteriorSd)
  const lossShipARelative = relativeLossShipA(posteriorMean, posteriorSd)

  const checks = {
    bBeatsAReached: bBeatsA >= threshold,
    aBeatsBReached: 1 - bBeatsA >= threshold,
    shipBLossAcceptable: lossShipBRelative <= maxRelativeLoss,
    keepALossAcceptable: lossShipARelative <= maxRelativeLoss,
    /* The data has to outweigh the prior here: a tight prior alone can squeeze
       the interval inside the band, which would claim "no difference" before
       the test had shown anything. */
    withinNoEffectBand:
      minEffect > 0 &&
      dataWeight >= priorWeight &&
      posteriorMean - CI_Z * posteriorSd > lower &&
      posteriorMean + CI_Z * posteriorSd < upper,
  }

  let status: SkepticalStatus = "continue"
  if (checks.bBeatsAReached && checks.shipBLossAcceptable) status = "ship_b"
  else if (checks.aBeatsBReached && checks.keepALossAcceptable) status = "keep_a"
  else if (checks.withinNoEffectBand) status = "no_meaningful_difference"

  return {
    observed,
    noise,
    posteriorMean,
    posteriorSd,
    priorWeight,
    dataWeight,
    bBeatsA,
    meaningfulLift,
    meaningfulHarm,
    lossShipBRelative,
    lossShipARelative,
    status,
    checks,
  }
}

function normalDensity(x: number, mean: number, sd: number): number {
  const z = (x - mean) / sd
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI))
}

/** Prior, data and posterior densities over the relative lift, each scaled so its peak is 1. */
function chart(observed: number, noise: number, priorSd: number, posteriorMean: number, posteriorSd: number): SkepticalChartPoint[] {
  const low = Math.min(-3.5 * priorSd, posteriorMean - 4 * posteriorSd, observed - 3 * noise)
  const high = Math.max(3.5 * priorSd, posteriorMean + 4 * posteriorSd, observed + 3 * noise)
  /* A very noisy test would stretch the axis until the posterior is a sliver,
     so the window is capped at a few prior widths around the posterior. */
  const cap = Math.max(8 * priorSd, 8 * posteriorSd)
  const from = Math.max(low, posteriorMean - cap)
  const to = Math.min(high, posteriorMean + cap)
  const peak = (sd: number) => 1 / (sd * Math.sqrt(2 * Math.PI))
  return Array.from({ length: CHART_POINTS }, (_, index) => {
    const logLift = from + ((to - from) * index) / (CHART_POINTS - 1)
    return {
      relativeLift: Math.exp(logLift) - 1,
      prior: normalDensity(logLift, 0, priorSd) / peak(priorSd),
      data: normalDensity(logLift, observed, noise) / peak(noise),
      posterior: normalDensity(logLift, posteriorMean, posteriorSd) / peak(posteriorSd),
    }
  })
}

function formatPercentParam(fraction: number): string {
  return String(Number((fraction * 100).toPrecision(10)))
}

export function skepticalShareUrl(inputs: SkepticalResult["inputs"]): string {
  const params = new URLSearchParams({
    visitorsA: String(inputs.visitorsA),
    conversionsA: String(inputs.conversionsA),
    visitorsB: String(inputs.visitorsB),
    conversionsB: String(inputs.conversionsB),
    liftPriorSdPercent: formatPercentParam(inputs.liftPriorSd),
    thresholdPercent: formatPercentParam(inputs.threshold),
    meaningfulLiftPercent: formatPercentParam(inputs.minEffect),
    maxLossPercent: formatPercentParam(inputs.maxRelativeLoss),
  })
  return `${SKEPTICAL_WEB_TOOL_URL}?${params.toString()}`
}

export function analyzeSkeptical({
  visitorsA,
  conversionsA,
  visitorsB,
  conversionsB,
  liftPriorSd = DEFAULT_LIFT_PRIOR_SD,
  threshold = DEFAULT_THRESHOLD,
  minEffect = DEFAULT_SKEPTICAL_MIN_EFFECT,
  maxRelativeLoss = DEFAULT_MAX_RELATIVE_LOSS,
  includeChart = false,
}: SkepticalInputs): SkepticalResult {
  validateCounts(visitorsA, conversionsA, "A")
  validateCounts(visitorsB, conversionsB, "B")
  validateFraction("liftPriorSd", liftPriorSd, { min: 0, max: 1 })
  validateFraction("threshold", threshold, { min: 0.5, max: 1 })
  validateFraction("minEffect", minEffect, { min: 0, max: 1, inclusiveMin: true })
  validateFraction("maxRelativeLoss", maxRelativeLoss, { min: 0, max: 1, inclusiveMin: true })

  const { logLift: observed, noise, adjusted } = observedLogLift(visitorsA, conversionsA, visitorsB, conversionsB)
  const result = core(observed, noise, liftPriorSd, threshold, minEffect, maxRelativeLoss)
  const { posteriorMean: m, posteriorSd: s } = result

  const rateA = conversionsA / visitorsA
  const rateB = conversionsB / visitorsB
  const baselineRate = adjusted ? (conversionsA + 0.5) / (visitorsA + 1) : rateA
  const relativeLift = Math.exp(m) - 1
  const relativeLiftCI95: [number, number] = [Math.exp(m - CI_Z * s) - 1, Math.exp(m + CI_Z * s) - 1]

  const priorEquivalentConversionsPerVariant = 2 * result.priorWeight
  const smallerArm = Math.min(visitorsA, visitorsB)
  const requiredPerVariant = requiredSamplePerVariant({ baseline: baselineRate, minEffect: Math.max(minEffect, 0.01) })

  const rows: SkepticalSensitivityRow[] = SENSITIVITY_FACTORS.map((factor) => {
    const sd = liftPriorSd * factor
    const row = core(observed, noise, sd, threshold, minEffect, maxRelativeLoss)
    return { liftPriorSd: sd, status: row.status, relativeLift: Math.exp(row.posteriorMean) - 1, bBeatsA: row.bBeatsA }
  })
  const robust = rows.every((row) => row.status === result.status)

  const warnings: SkepticalWarning[] = []
  if (Math.min(conversionsA, conversionsB) < MIN_RELIABLE_CONVERSIONS) warnings.push("few_conversions")
  if (adjusted) warnings.push("zero_or_all_conversions")
  if (!robust) warnings.push("decision_sensitive_to_prior")

  const inputs = { visitorsA, conversionsA, visitorsB, conversionsB, liftPriorSd, threshold, minEffect, maxRelativeLoss }
  const output: SkepticalResult = {
    inputs,
    decision: { status: result.status, label: SKEPTICAL_LABELS[result.status], checks: result.checks },
    logLift: { observed, noise, priorSd: liftPriorSd, posteriorMean: m, posteriorSd: s },
    weights: {
      prior: result.priorWeight,
      data: result.dataWeight,
      dataShare: result.dataWeight / (result.priorWeight + result.dataWeight),
      priorEquivalentConversionsPerVariant,
      priorEquivalentVisitorsPerVariant: priorEquivalentConversionsPerVariant / Math.max(baselineRate, 1e-9),
    },
    probability: {
      bBeatsA: result.bBeatsA,
      aBeatsB: 1 - result.bBeatsA,
      meaningfulLift: result.meaningfulLift,
      meaningfulHarm: result.meaningfulHarm,
    },
    effect: {
      observedRelativeLift: rateA > 0 ? rateB / rateA - 1 : null,
      relativeLift,
      relativeLiftMean: Math.exp(m + (s * s) / 2) - 1,
      relativeLiftCI95,
      absoluteDiff: baselineRate * relativeLift,
      absoluteDiffCI95: [baselineRate * relativeLiftCI95[0], baselineRate * relativeLiftCI95[1]],
    },
    expectedLoss: {
      shipA: baselineRate * result.lossShipARelative,
      shipB: baselineRate * result.lossShipBRelative,
      shipARelative: result.lossShipARelative,
      shipBRelative: result.lossShipBRelative,
    },
    variants: {
      A: { visitors: visitorsA, conversions: conversionsA, rate: rateA },
      B: { visitors: visitorsB, conversions: conversionsB, rate: rateB },
    },
    sampleSize: {
      baselineRate,
      requiredPerVariant,
      additionalPerVariant: Math.max(0, requiredPerVariant - smallerArm),
      progress: clamp(smallerArm / Math.max(requiredPerVariant, 1), 0, 1),
    },
    sensitivity: { rows, robust },
    warnings,
    approximation: "normal",
    shareUrl: skepticalShareUrl(inputs),
  }
  if (includeChart) output.chart = chart(observed, noise, liftPriorSd, m, s)
  return output
}

/* ------------------------------------------------------------------------ */
/* Calibration: how big are real lifts, judging by past tests?              */
/* ------------------------------------------------------------------------ */

export type PastTest = {
  visitorsA: number
  conversionsA: number
  visitorsB: number
  conversionsB: number
}

export type CalibrationResult = {
  tests: number
  /** Suggested liftPriorSd: the spread of true log lifts, with the noise taken out. */
  liftPriorSd: number
  /** True when the estimate fell below MIN_CALIBRATED_SD and was raised to it. */
  floored: boolean
  /** Spread of the observed lifts, noise included. */
  observedSd: number
  /** Typical noise of a single past test. */
  typicalNoise: number
  /** Precision-weighted average log lift; near zero when tests are as likely to hurt as help. */
  averageLogLift: number
  method: "dersimonian-laird"
  warnings: ("few_tests" | "no_spread_beyond_noise" | "average_not_zero")[]
  perTest: { relativeLift: number; logLift: number; noise: number }[]
}

/**
 * Estimates the spread of true lifts from past tests with the DerSimonian-Laird
 * estimator from meta-analysis: the observed lifts vary for two reasons, real
 * differences between tests and noise within each, and the method subtracts
 * the second from the first. Needs at least 3 tests; 10 or more to be useful.
 */
export function calibrateLiftPrior(pastTests: PastTest[]): CalibrationResult {
  if (pastTests.length < 3) throw new RangeError(`Calibration needs at least 3 past tests, got ${pastTests.length}.`)
  pastTests.forEach((test, index) => {
    validateCounts(test.visitorsA, test.conversionsA, `A (test ${index + 1})`)
    validateCounts(test.visitorsB, test.conversionsB, `B (test ${index + 1})`)
  })

  const perTest = pastTests.map((test) => {
    const { logLift, noise } = observedLogLift(test.visitorsA, test.conversionsA, test.visitorsB, test.conversionsB)
    return { relativeLift: Math.exp(logLift) - 1, logLift, noise }
  })
  const k = perTest.length
  const weights = perTest.map((test) => 1 / (test.noise * test.noise))
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const averageLogLift = perTest.reduce((sum, test, index) => sum + weights[index]! * test.logLift, 0) / totalWeight
  const q = perTest.reduce((sum, test, index) => sum + weights[index]! * (test.logLift - averageLogLift) ** 2, 0)
  const c = totalWeight - weights.reduce((sum, w) => sum + w * w, 0) / totalWeight
  const tauSquared = Math.max(0, (q - (k - 1)) / c)
  const tau = Math.sqrt(tauSquared)

  const plainMean = perTest.reduce((sum, test) => sum + test.logLift, 0) / k
  const observedSd = Math.sqrt(perTest.reduce((sum, test) => sum + (test.logLift - plainMean) ** 2, 0) / Math.max(k - 1, 1))
  const typicalNoise = Math.sqrt(perTest.reduce((sum, test) => sum + test.noise * test.noise, 0) / k)

  const warnings: CalibrationResult["warnings"] = []
  if (k < 10) warnings.push("few_tests")
  if (tau < MIN_CALIBRATED_SD) warnings.push("no_spread_beyond_noise")
  /* The skeptical prior is centered on zero. If past tests lean clearly one
     way, say so; the spread is still estimated around their own average. */
  const averageNoise = 1 / Math.sqrt(totalWeight)
  if (Math.abs(averageLogLift) > 2 * Math.sqrt(averageNoise * averageNoise + tauSquared / k)) warnings.push("average_not_zero")

  return {
    tests: k,
    liftPriorSd: Math.max(tau, MIN_CALIBRATED_SD),
    floored: tau < MIN_CALIBRATED_SD,
    observedSd,
    typicalNoise,
    averageLogLift,
    method: "dersimonian-laird",
    warnings,
    perTest,
  }
}

/**
 * Parses past tests from CSV: one test per line as
 * visitorsA,conversionsA,visitorsB,conversionsB. A header line, blank lines,
 * lines starting with # and thousands separators inside quotes are tolerated.
 */
export function parsePastTestsCsv(text: string): PastTest[] {
  const tests: PastTest[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (line === "" || line.startsWith("#")) return
    const cells = line.match(/("[^"]*"|[^,]+)/g)?.map((cell) => cell.replace(/"/g, "").replace(/[,_\s]/g, "")) ?? []
    if (cells.length === 0) return
    if (cells.some((cell) => !/^\d+$/.test(cell))) {
      if (tests.length === 0 && /[a-z]/i.test(line)) return
      throw new RangeError(`Line ${index + 1}: expected four whole numbers (visitorsA,conversionsA,visitorsB,conversionsB), got "${rawLine}".`)
    }
    if (cells.length !== 4) {
      throw new RangeError(`Line ${index + 1}: expected 4 columns (visitorsA,conversionsA,visitorsB,conversionsB), got ${cells.length}.`)
    }
    const [visitorsA, conversionsA, visitorsB, conversionsB] = cells.map(Number) as [number, number, number, number]
    tests.push({ visitorsA, conversionsA, visitorsB, conversionsB })
  })
  return tests
}
