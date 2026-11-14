import { betaPdf, quantile } from "./math.ts"

export type LiftDensityPoint = {
  relativeLift: number
  /** Scaled so the peak is 1. */
  density: number
}

const LIFT_DENSITY_POINTS = 160
const LIFT_INTEGRATION_STEPS = 400

/**
 * Density of B's relative lift over A, computed exactly rather than
 * histogrammed from the Monte Carlo samples. Writing B = A(1 + r), the ratio
 * density is f(r) = ∫ a · f_A(a) · f_B(a(1+r)) da, which is one Simpson
 * integral per grid point. A histogram of 12k draws carries ~10% sampling
 * noise per bin, and on a wide posterior that reads as a jagged curve.
 *
 * The sorted Monte Carlo lifts only set the plotted range (0.2% to 99.8%).
 */
export function liftDensity(
  alphaA: number,
  betaA: number,
  alphaB: number,
  betaB: number,
  sortedRelativeLifts: number[]
): LiftDensityPoint[] {
  const lower = quantile(sortedRelativeLifts, 0.002)
  const upper = quantile(sortedRelativeLifts, 0.998)
  const span = upper - lower

  if (!Number.isFinite(span) || span <= 0) {
    return [
      { relativeLift: lower, density: 0 },
      { relativeLift: lower, density: 1 },
      { relativeLift: lower, density: 0 },
    ]
  }

  /* A's posterior occupies a narrow slice of [0,1], so integrate only where it
     has mass instead of sweeping the whole unit interval. */
  const totalA = alphaA + betaA
  const meanA = alphaA / totalA
  const sdA = Math.sqrt((alphaA * betaA) / (totalA * totalA * (totalA + 1)))
  const aLow = Math.max(1e-9, meanA - 10 * sdA)
  const aHighBase = Math.min(1 - 1e-9, meanA + 10 * sdA)

  const lifts = Array.from(
    { length: LIFT_DENSITY_POINTS },
    (_, index) => lower + (span * index) / (LIFT_DENSITY_POINTS - 1)
  )

  const densities = lifts.map((relativeLift) => {
    const ratio = 1 + relativeLift
    if (ratio <= 0) return 0

    const aHigh = Math.min(aHighBase, (1 - 1e-9) / ratio)
    if (aHigh <= aLow) return 0

    const step = (aHigh - aLow) / LIFT_INTEGRATION_STEPS
    let total = 0
    for (let index = 0; index <= LIFT_INTEGRATION_STEPS; index += 1) {
      const a = aLow + step * index
      const weight = index === 0 || index === LIFT_INTEGRATION_STEPS ? 1 : index % 2 ? 4 : 2
      total += weight * a * betaPdf(a, alphaA, betaA) * betaPdf(a * ratio, alphaB, betaB)
    }
    return (total * step) / 3
  })

  const peak = Math.max(...densities, Number.MIN_VALUE)
  return lifts.map((relativeLift, index) => ({
    relativeLift,
    density: (densities[index] as number) / peak,
  }))
}
