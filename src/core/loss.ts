import { betaPdf, clamp } from "./math.ts"

/**
 * Expected loss of each choice by direct numerical integration over a 600-step
 * grid, with no sampling. Deterministic and smooth in its inputs, so it suits
 * curves that sweep sample size; `analyze` uses Monte Carlo instead because it
 * shares those draws with the lift interval and threshold probabilities.
 *
 * Losses are absolute conversion-rate differences (0.001 = 0.1 pp):
 * shipA = E[max(B − A, 0)], shipB = E[max(A − B, 0)].
 */
export function integratedExpectedLoss(
  alphaA: number,
  betaA: number,
  alphaB: number,
  betaB: number
): { shipA: number; shipB: number } {
  const GRID = 600
  const dx = 1 / GRID
  let cdfA = 0
  let cdfB = 0
  let weightedSumA = 0
  let weightedSumB = 0
  let shipB = 0
  let shipA = 0

  for (let i = 0; i <= GRID; i += 1) {
    const x = clamp(i * dx, 1e-6, 1 - 1e-6)
    const fA = betaPdf(x, alphaA, betaA)
    const fB = betaPdf(x, alphaB, betaB)

    shipB += fA * (x * cdfB - weightedSumB) * dx
    shipA += fB * (x * cdfA - weightedSumA) * dx

    cdfA += fA * dx
    weightedSumA += x * fA * dx
    cdfB += fB * dx
    weightedSumB += x * fB * dx
  }

  return { shipA: Math.max(shipA, 0), shipB: Math.max(shipB, 0) }
}
