import {
  betaPdf,
  clamp,
  inverseNormalCdf,
  makeDeterministicRandom,
  mean,
  normalCdf,
  probabilityBBeatsA,
  quantile,
  sampleBeta,
  sampleBinomialApprox,
} from "./math.ts"
import { requiredSamplePerVariant } from "./plan.ts"
import { shareUrl } from "./share.ts"

export const DEFAULT_THRESHOLD = 0.95
export const DEFAULT_MIN_EFFECT = 0.1
export const DEFAULT_SAMPLES = 12000
export const PRIOR_ALPHA = 1
export const PRIOR_BETA = 1

const POSTERIOR_CHART_POINTS = 96
const WAITING_SCENARIOS = [1000, 2000, 5000, 10000]
const WAITING_VALUE_SIMULATIONS = 1500

export type DecisionStatus = "ship_b" | "keep_a" | "continue" | "inconclusive"
export type EvidenceStrength = "low" | "moderate" | "strong"
export type Maturity = "early" | "building" | "mature"
export type Variant = "A" | "B"

export const DECISION_LABELS: Record<DecisionStatus, string> = {
  ship_b: "Ship Variant B",
  keep_a: "Keep Variant A",
  continue: "Continue test",
  inconclusive: "Inconclusive",
}

export type AnalyzeInputs = {
  visitorsA: number
  conversionsA: number
  visitorsB: number
  conversionsB: number
  threshold?: number
  minEffect?: number
  samples?: number
  seed?: number | null
  includeChart?: boolean
}

export type VariantSummary = {
  visitors: number
  conversions: number
  rate: number
  posteriorMean: number
  posterior: [number, number]
}

export type WaitingScenario = {
  extraPerVariant: number
  expectedRegret: number
  valueOfWaiting: number
}

export type ChartPoint = {
  rate: number
  densityA: number
  densityB: number
}

export type AnalyzeResult = {
  inputs: {
    visitorsA: number
    conversionsA: number
    visitorsB: number
    conversionsB: number
    threshold: number
    minEffect: number
    prior: [number, number]
    samples: number
    seed: number
  }
  decision: {
    status: DecisionStatus
    label: string
    evidence: EvidenceStrength
    maturity: Maturity
    maturityProgress: number
    bayesActionNow: Variant
    expectedRegretNow: number
  }
  probability: {
    bBeatsA: number
    aBeatsB: number
    meaningfulLift: number
    meaningfulHarm: number
    harmful: number
    liftAbove1pct: number
    liftAbove5pct: number
    harmBeyond5pct: number
    harmBeyond10pct: number
  }
  effect: {
    relativeLift: number
    relativeLiftCI95: [number, number]
    absoluteDiff: number
    absoluteDiffCI95: [number, number]
    observedRelativeLift: number | null
    observedAbsoluteDiff: number
  }
  expectedLoss: { shipA: number; shipB: number }
  variants: { A: VariantSummary; B: VariantSummary }
  sampleSize: {
    requiredPerVariant: number
    additionalPerVariant: number
    detectableEffectNow: number
  }
  waiting: WaitingScenario[]
  frequentist: { pValueTwoSided: number }
  chart?: ChartPoint[]
  shareUrl: string
}

export function deriveSeed(...parts: number[]): number {
  let hash = 2166136261
  for (const part of parts) {
    const text = String(part)
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 16777619) >>> 0
    }
    hash ^= 0x9e3779b9
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash >>> 0
}

function twoSidedPValue(visitorsA: number, conversionsA: number, visitorsB: number, conversionsB: number): number {
  const pA = conversionsA / visitorsA
  const pB = conversionsB / visitorsB
  const pooled = (conversionsA + conversionsB) / (visitorsA + visitorsB)
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / visitorsA + 1 / visitorsB))
  if (standardError === 0) return 1
  const z = (pB - pA) / standardError
  return clamp(2 * (1 - normalCdf(Math.abs(z))), 0, 1)
}

function evidenceStrength(current: number, required: number): EvidenceStrength {
  const ratio = current / Math.max(required, 1)
  if (ratio < 0.5) return "low"
  if (ratio < 1) return "moderate"
  return "strong"
}

function maturity(progress: number): Maturity {
  if (progress < 0.35) return "early"
  if (progress < 0.85) return "building"
  return "mature"
}

export function decisionStatus({
  probabilityMeaningfulLift,
  probabilityMeaningfulHarm,
  threshold,
  evidence,
}: {
  probabilityMeaningfulLift: number
  probabilityMeaningfulHarm: number
  threshold: number
  evidence: EvidenceStrength
}): DecisionStatus {
  if (probabilityMeaningfulLift >= threshold) return "ship_b"
  if (probabilityMeaningfulHarm >= threshold) return "keep_a"
  if (evidence === "low") return "continue"
  return "inconclusive"
}

function chartData(
  alphaA: number,
  betaA: number,
  alphaB: number,
  betaB: number,
  sortedA: number[],
  sortedB: number[]
): ChartPoint[] {
  const minRate = Math.max(1e-4, Math.min(quantile(sortedA, 0.001), quantile(sortedB, 0.001)) * 0.9)
  const maxRate = Math.min(0.9999, Math.max(quantile(sortedA, 0.999), quantile(sortedB, 0.999)) * 1.1)
  const span = maxRate - minRate
  return Array.from({ length: POSTERIOR_CHART_POINTS }, (_, index) => {
    const rate = minRate + (span * index) / (POSTERIOR_CHART_POINTS - 1)
    return { rate, densityA: betaPdf(rate, alphaA, betaA), densityB: betaPdf(rate, alphaB, betaB) }
  })
}

function waitingScenarios(
  alphaA: number,
  betaA: number,
  alphaB: number,
  betaB: number,
  expectedRegretNow: number
): WaitingScenario[] {
  const random = makeDeterministicRandom(alphaA * 11 + betaA * 13 + alphaB * 17 + betaB * 19)
  return WAITING_SCENARIOS.map((extraPerVariant) => {
    let regretSum = 0
    for (let index = 0; index < WAITING_VALUE_SIMULATIONS; index += 1) {
      const trueRateA = sampleBeta(alphaA, betaA, random)
      const trueRateB = sampleBeta(alphaB, betaB, random)
      const extraA = sampleBinomialApprox(extraPerVariant, trueRateA, random)
      const extraB = sampleBinomialApprox(extraPerVariant, trueRateB, random)
      const futureMeanA = (alphaA + extraA) / (alphaA + betaA + extraPerVariant)
      const futureMeanB = (alphaB + extraB) / (alphaB + betaB + extraPerVariant)
      const regretIfChooseA = Math.max(trueRateB - trueRateA, 0)
      const regretIfChooseB = Math.max(trueRateA - trueRateB, 0)
      regretSum += futureMeanB >= futureMeanA ? regretIfChooseB : regretIfChooseA
    }
    const expectedRegret = regretSum / WAITING_VALUE_SIMULATIONS
    return { extraPerVariant, expectedRegret, valueOfWaiting: Math.max(0, expectedRegretNow - expectedRegret) }
  })
}

export function analyze({
  visitorsA,
  conversionsA,
  visitorsB,
  conversionsB,
  threshold = DEFAULT_THRESHOLD,
  minEffect = DEFAULT_MIN_EFFECT,
  samples = DEFAULT_SAMPLES,
  seed = null,
  includeChart = false,
}: AnalyzeInputs): AnalyzeResult {
  const alphaA = PRIOR_ALPHA + conversionsA
  const betaA = PRIOR_BETA + (visitorsA - conversionsA)
  const alphaB = PRIOR_ALPHA + conversionsB
  const betaB = PRIOR_BETA + (visitorsB - conversionsB)
  const rateA = conversionsA / visitorsA
  const rateB = conversionsB / visitorsB
  const posteriorMeanA = alphaA / (alphaA + betaA)
  const posteriorMeanB = alphaB / (alphaB + betaB)

  const pBBeatsA = clamp(probabilityBBeatsA(alphaA, betaA, alphaB, betaB), 0, 1)

  const resolvedSeed = seed ?? alphaA + betaA * 3 + alphaB * 5 + betaB * 7
  const random = makeDeterministicRandom(resolvedSeed)
  const samplesA = Array.from({ length: samples }, () => sampleBeta(alphaA, betaA, random))
  const samplesB = Array.from({ length: samples }, () => sampleBeta(alphaB, betaB, random))
  const relativeLifts = samplesA.map((sampleA, index) => (samplesB[index] as number) / sampleA - 1)
  const absoluteDiffs = samplesA.map((sampleA, index) => (samplesB[index] as number) - sampleA)
  const sortedRelativeLifts = [...relativeLifts].sort((left, right) => left - right)
  const sortedAbsoluteDiffs = [...absoluteDiffs].sort((left, right) => left - right)
  const share = (predicate: (lift: number) => boolean) =>
    mean(relativeLifts.map((lift) => (predicate(lift) ? 1 : 0)))

  const expectedLossShipA = mean(absoluteDiffs.map((difference) => Math.max(difference, 0)))
  const expectedLossShipB = mean(absoluteDiffs.map((difference) => Math.max(-difference, 0)))
  const bayesActionNow: Variant = expectedLossShipB <= expectedLossShipA ? "B" : "A"
  const expectedRegretNow = bayesActionNow === "B" ? expectedLossShipB : expectedLossShipA

  const baselineRate = (posteriorMeanA + posteriorMeanB) / 2
  const smallerArm = Math.min(visitorsA, visitorsB)
  const requiredPerVariant = requiredSamplePerVariant({ baseline: baselineRate, minEffect })
  const evidence = evidenceStrength(smallerArm, requiredPerVariant)
  const maturityProgress = clamp(smallerArm / Math.max(requiredPerVariant, 1), 0, 1)
  const probabilityMeaningfulLift = share((lift) => lift > minEffect)
  const probabilityMeaningfulHarm = share((lift) => lift < -minEffect)
  const status = decisionStatus({ probabilityMeaningfulLift, probabilityMeaningfulHarm, threshold, evidence })

  const result: AnalyzeResult = {
    inputs: {
      visitorsA,
      conversionsA,
      visitorsB,
      conversionsB,
      threshold,
      minEffect,
      prior: [PRIOR_ALPHA, PRIOR_BETA],
      samples,
      seed: resolvedSeed,
    },
    decision: {
      status,
      label: DECISION_LABELS[status],
      evidence,
      maturity: maturity(maturityProgress),
      maturityProgress,
      bayesActionNow,
      expectedRegretNow,
    },
    probability: {
      bBeatsA: pBBeatsA,
      aBeatsB: 1 - pBBeatsA,
      meaningfulLift: probabilityMeaningfulLift,
      meaningfulHarm: probabilityMeaningfulHarm,
      harmful: share((lift) => lift < 0),
      liftAbove1pct: share((lift) => lift > 0.01),
      liftAbove5pct: share((lift) => lift > 0.05),
      harmBeyond5pct: share((lift) => lift < -0.05),
      harmBeyond10pct: share((lift) => lift < -0.1),
    },
    effect: {
      relativeLift: posteriorMeanB / posteriorMeanA - 1,
      relativeLiftCI95: [quantile(sortedRelativeLifts, 0.025), quantile(sortedRelativeLifts, 0.975)],
      absoluteDiff: posteriorMeanB - posteriorMeanA,
      absoluteDiffCI95: [quantile(sortedAbsoluteDiffs, 0.025), quantile(sortedAbsoluteDiffs, 0.975)],
      observedRelativeLift: rateA > 0 ? rateB / rateA - 1 : null,
      observedAbsoluteDiff: rateB - rateA,
    },
    expectedLoss: { shipA: expectedLossShipA, shipB: expectedLossShipB },
    variants: {
      A: { visitors: visitorsA, conversions: conversionsA, rate: rateA, posteriorMean: posteriorMeanA, posterior: [alphaA, betaA] },
      B: { visitors: visitorsB, conversions: conversionsB, rate: rateB, posteriorMean: posteriorMeanB, posterior: [alphaB, betaB] },
    },
    sampleSize: {
      requiredPerVariant,
      additionalPerVariant: Math.max(0, requiredPerVariant - smallerArm),
      detectableEffectNow:
        ((inverseNormalCdf(1 - 0.05 / 2) + inverseNormalCdf(0.8)) *
          Math.sqrt((2 * baselineRate * (1 - baselineRate)) / smallerArm)) /
        baselineRate,
    },
    waiting: waitingScenarios(alphaA, betaA, alphaB, betaB, expectedRegretNow),
    frequentist: { pValueTwoSided: twoSidedPValue(visitorsA, conversionsA, visitorsB, conversionsB) },
    shareUrl: shareUrl({ visitorsA, conversionsA, visitorsB, conversionsB, threshold, minEffect }),
  }

  if (includeChart) {
    const sortedA = [...samplesA].sort((left, right) => left - right)
    const sortedB = [...samplesB].sort((left, right) => left - right)
    result.chart = chartData(alphaA, betaA, alphaB, betaB, sortedA, sortedB)
  }

  return result
}
