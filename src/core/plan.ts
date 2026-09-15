import { clamp, inverseNormalCdf } from "./math.ts"

export type PlanInputs = {
  baseline: number
  minEffect: number
  power?: number
  alpha?: number
  dailyVisitors?: number | null
}

export type PlanRow = {
  minEffect: number
  perVariant: number
  days: number | null
}

export type PlanResult = {
  inputs: {
    baseline: number
    minEffect: number
    power: number
    alpha: number
    dailyVisitors: number | null
  }
  targetRates: { up: number; down: number }
  perVariant: number
  total: number
  days: number | null
  sensitivity: PlanRow[]
}

const SENSITIVITY_EFFECTS = [0.05, 0.1, 0.15, 0.2]

/**
 * Visitors per variant to detect a relative change of `minEffect` from `baseline`
 * with a two-sided z-test. This is the same yardstick the web tool uses for its
 * maturity bar: a planning number, not the Bayesian decision rule.
 */
export function requiredSamplePerVariant({
  baseline,
  minEffect,
  alpha = 0.05,
  power = 0.8,
}: {
  baseline: number
  minEffect: number
  alpha?: number
  power?: number
}): number {
  const boundedBaseline = clamp(baseline, 1e-6, 1 - 1e-6)
  const absoluteDelta = Math.max(boundedBaseline * minEffect, 1e-6)
  const zAlpha = inverseNormalCdf(1 - alpha / 2)
  const zPower = inverseNormalCdf(power)
  const standardDeviation = Math.sqrt(2 * boundedBaseline * (1 - boundedBaseline))
  return Math.ceil((((zAlpha + zPower) * standardDeviation) / absoluteDelta) ** 2)
}

export function plan({ baseline, minEffect, power = 0.8, alpha = 0.05, dailyVisitors = null }: PlanInputs): PlanResult {
  const daysFor = (perVariant: number) =>
    dailyVisitors && dailyVisitors > 0 ? Math.ceil(perVariant / dailyVisitors) : null
  const perVariant = requiredSamplePerVariant({ baseline, minEffect, alpha, power })
  const effects = SENSITIVITY_EFFECTS.includes(minEffect)
    ? SENSITIVITY_EFFECTS
    : [...SENSITIVITY_EFFECTS, minEffect].sort((left, right) => left - right)

  return {
    inputs: { baseline, minEffect, power, alpha, dailyVisitors },
    targetRates: { up: baseline * (1 + minEffect), down: baseline * (1 - minEffect) },
    perVariant,
    total: perVariant * 2,
    days: daysFor(perVariant),
    sensitivity: effects.map((effect) => {
      const rowPerVariant = requiredSamplePerVariant({ baseline, minEffect: effect, alpha, power })
      return { minEffect: effect, perVariant: rowPerVariant, days: daysFor(rowPerVariant) }
    }),
  }
}
