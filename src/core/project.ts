import { analyze, deriveSeed, type AnalyzeResult, DEFAULT_MIN_EFFECT, DEFAULT_THRESHOLD, PRIOR_ALPHA, PRIOR_BETA } from "./analyze.ts"
import { makeDeterministicRandom, normalCdf, normalPdf, quantile, sampleBeta, sampleBinomialApprox } from "./math.ts"
import { shareUrl } from "./share.ts"

export type StopRule = "lift" | "superiority" | "loss"
export type ProjectedDecision = "ship_b" | "keep_a"

export const DEFAULT_HORIZON_DAYS = 28
export const DEFAULT_SIMULATIONS = 2000
export const DEFAULT_MAX_LOSS = 0.0001

export type ProjectInputs = {
  visitorsA: number
  conversionsA: number
  visitorsB: number
  conversionsB: number
  dailyVisitors: number
  horizonDays?: number
  threshold?: number
  minEffect?: number
  stopRule?: StopRule
  maxLoss?: number
  simulations?: number
  seed?: number | null
}

export type ProjectResult = {
  inputs: {
    visitorsA: number
    conversionsA: number
    visitorsB: number
    conversionsB: number
    threshold: number
    minEffect: number
    prior: [number, number]
    dailyVisitors: number
    horizonDays: number
    stopRule: StopRule
    maxLoss: number | null
    simulations: number
    seed: number
  }
  alreadyDecided: boolean
  decisionNow: ProjectedDecision | null
  decisionWithinHorizon: number
  outcomes: { shipB: number; keepA: number; undecided: number }
  daysToDecision: { p25: number; p50: number; p75: number; p90: number } | null
  cumulative: { day: number; p: number }[]
  diagnostic: "lift_near_threshold" | null
  approximation: "normal"
  shareUrl: string
}

type Posterior = { alpha: number; beta: number }

function moments({ alpha, beta }: Posterior): { mean: number; variance: number } {
  const total = alpha + beta
  return { mean: alpha / total, variance: (alpha * beta) / (total * total * (total + 1)) }
}

/**
 * P(B - k·A > 0) under a normal approximation to the two Beta posteriors.
 * Exact enough once each arm has a few dozen conversions, and thousands of
 * times faster than Monte Carlo, which is what makes a day-by-day sweep cheap.
 */
function probabilityBExceedsScaledA(a: Posterior, b: Posterior, k: number): number {
  const mA = moments(a)
  const mB = moments(b)
  const mean = mB.mean - k * mA.mean
  const sd = Math.sqrt(mB.variance + k * k * mA.variance)
  if (sd === 0) return mean > 0 ? 1 : 0
  return normalCdf(mean / sd)
}

function expectedLosses(a: Posterior, b: Posterior): { shipA: number; shipB: number } {
  const mA = moments(a)
  const mB = moments(b)
  const mean = mB.mean - mA.mean
  const sd = Math.sqrt(mA.variance + mB.variance)
  if (sd === 0) return { shipA: Math.max(mean, 0), shipB: Math.max(-mean, 0) }
  const z = mean / sd
  return {
    shipA: mean * normalCdf(z) + sd * normalPdf(z),
    shipB: -mean * normalCdf(-z) + sd * normalPdf(z),
  }
}

function evaluateRule(
  a: Posterior,
  b: Posterior,
  rule: StopRule,
  threshold: number,
  minEffect: number,
  maxLoss: number
): ProjectedDecision | null {
  if (rule === "loss") {
    const loss = expectedLosses(a, b)
    if (Math.min(loss.shipA, loss.shipB) > maxLoss) return null
    return loss.shipB <= loss.shipA ? "ship_b" : "keep_a"
  }
  const effect = rule === "lift" ? minEffect : 0
  if (probabilityBExceedsScaledA(a, b, 1 + effect) >= threshold) return "ship_b"
  if (1 - probabilityBExceedsScaledA(a, b, 1 - effect) >= threshold) return "keep_a"
  return null
}

function decisionNowFrom(current: AnalyzeResult, rule: StopRule, threshold: number, maxLoss: number): ProjectedDecision | null {
  if (rule === "lift") {
    if (current.decision.status === "ship_b" || current.decision.status === "keep_a") return current.decision.status
    return null
  }
  if (rule === "superiority") {
    if (current.probability.bBeatsA >= threshold) return "ship_b"
    if (current.probability.aBeatsB >= threshold) return "keep_a"
    return null
  }
  const { shipA, shipB } = current.expectedLoss
  if (Math.min(shipA, shipB) > maxLoss) return null
  return shipB <= shipA ? "ship_b" : "keep_a"
}

function checkpoints(horizonDays: number): number[] {
  const days: number[] = []
  for (let day = 7; day < horizonDays; day += 7) days.push(day)
  days.push(horizonDays)
  return days
}

function liftNearThreshold(current: AnalyzeResult, minEffect: number): boolean {
  const lift = current.effect.relativeLift
  const [lower, upper] = current.effect.relativeLiftCI95
  const distance = Math.min(Math.abs(lift - minEffect), Math.abs(lift + minEffect))
  return distance < (upper - lower) / 8
}

export function project({
  visitorsA,
  conversionsA,
  visitorsB,
  conversionsB,
  dailyVisitors,
  horizonDays = DEFAULT_HORIZON_DAYS,
  threshold = DEFAULT_THRESHOLD,
  minEffect = DEFAULT_MIN_EFFECT,
  stopRule = "lift",
  maxLoss = DEFAULT_MAX_LOSS,
  simulations = DEFAULT_SIMULATIONS,
  seed = null,
}: ProjectInputs): ProjectResult {
  const current = analyze({ visitorsA, conversionsA, visitorsB, conversionsB, threshold, minEffect })
  const resolvedSeed =
    seed ??
    deriveSeed(visitorsA, conversionsA, visitorsB, conversionsB, dailyVisitors, horizonDays, ["lift", "superiority", "loss"].indexOf(stopRule), simulations)
  const inputs: ProjectResult["inputs"] = {
    visitorsA,
    conversionsA,
    visitorsB,
    conversionsB,
    threshold,
    minEffect,
    prior: [PRIOR_ALPHA, PRIOR_BETA],
    dailyVisitors,
    horizonDays,
    stopRule,
    maxLoss: stopRule === "loss" ? maxLoss : null,
    simulations,
    seed: resolvedSeed,
  }
  const link = shareUrl({ visitorsA, conversionsA, visitorsB, conversionsB, threshold, minEffect })
  const diagnostic = stopRule === "lift" && liftNearThreshold(current, minEffect) ? "lift_near_threshold" : null

  const decisionNow = decisionNowFrom(current, stopRule, threshold, maxLoss)
  if (decisionNow) {
    return {
      inputs,
      alreadyDecided: true,
      decisionNow,
      decisionWithinHorizon: 1,
      outcomes: { shipB: decisionNow === "ship_b" ? 1 : 0, keepA: decisionNow === "keep_a" ? 1 : 0, undecided: 0 },
      daysToDecision: { p25: 0, p50: 0, p75: 0, p90: 0 },
      cumulative: checkpoints(horizonDays).map((day) => ({ day, p: 1 })),
      diagnostic,
      approximation: "normal",
      shareUrl: link,
    }
  }

  const alphaA0 = PRIOR_ALPHA + conversionsA
  const betaA0 = PRIOR_BETA + (visitorsA - conversionsA)
  const alphaB0 = PRIOR_ALPHA + conversionsB
  const betaB0 = PRIOR_BETA + (visitorsB - conversionsB)
  const random = makeDeterministicRandom(resolvedSeed)
  const decidedByDay = new Array<number>(horizonDays + 1).fill(0)
  const decisionDays: number[] = []
  let shipB = 0
  let keepA = 0

  for (let simulation = 0; simulation < simulations; simulation += 1) {
    const trueRateA = sampleBeta(alphaA0, betaA0, random)
    const trueRateB = sampleBeta(alphaB0, betaB0, random)
    const a: Posterior = { alpha: alphaA0, beta: betaA0 }
    const b: Posterior = { alpha: alphaB0, beta: betaB0 }
    for (let day = 1; day <= horizonDays; day += 1) {
      const newA = sampleBinomialApprox(dailyVisitors, trueRateA, random)
      const newB = sampleBinomialApprox(dailyVisitors, trueRateB, random)
      a.alpha += newA
      a.beta += dailyVisitors - newA
      b.alpha += newB
      b.beta += dailyVisitors - newB
      const decision = evaluateRule(a, b, stopRule, threshold, minEffect, maxLoss)
      if (decision) {
        if (decision === "ship_b") shipB += 1
        else keepA += 1
        decidedByDay[day] = (decidedByDay[day] as number) + 1
        decisionDays.push(day)
        break
      }
    }
  }

  let running = 0
  const cumulativeByDay = decidedByDay.map((count) => {
    running += count
    return running / simulations
  })
  const sortedDays = [...decisionDays].sort((left, right) => left - right)

  return {
    inputs,
    alreadyDecided: false,
    decisionNow: null,
    decisionWithinHorizon: decisionDays.length / simulations,
    outcomes: {
      shipB: shipB / simulations,
      keepA: keepA / simulations,
      undecided: (simulations - decisionDays.length) / simulations,
    },
    daysToDecision:
      sortedDays.length === 0
        ? null
        : {
            p25: quantile(sortedDays, 0.25),
            p50: quantile(sortedDays, 0.5),
            p75: quantile(sortedDays, 0.75),
            p90: quantile(sortedDays, 0.9),
          },
    cumulative: checkpoints(horizonDays).map((day) => ({ day, p: cumulativeByDay[day] as number })),
    diagnostic,
    approximation: "normal",
    shareUrl: link,
  }
}
