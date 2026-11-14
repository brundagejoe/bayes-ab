import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { integratedExpectedLoss } from "../src/core/loss.ts"
import { betaPdf } from "../src/core/math.ts"
import { analyze } from "../src/core/analyze.ts"

describe("integratedExpectedLoss", () => {
  it("is zero-sum symmetric when the variants are swapped", () => {
    const forward = integratedExpectedLoss(23, 229, 61, 441)
    const reverse = integratedExpectedLoss(61, 441, 23, 229)
    assert.ok(Math.abs(forward.shipA - reverse.shipB) < 1e-12)
    assert.ok(Math.abs(forward.shipB - reverse.shipA) < 1e-12)
  })

  it("agrees with the Monte Carlo loss in analyze", () => {
    const result = analyze({ visitorsA: 1500, conversionsA: 84, visitorsB: 1500, conversionsB: 93 })
    const [alphaA, betaA] = result.variants.A.posterior
    const [alphaB, betaB] = result.variants.B.posterior
    const integrated = integratedExpectedLoss(alphaA, betaA, alphaB, betaB)
    assert.ok(Math.abs(integrated.shipA - result.expectedLoss.shipA) < 2e-4)
    assert.ok(Math.abs(integrated.shipB - result.expectedLoss.shipB) < 2e-4)
  })

  it("prefers B on the primer's week-6 data", () => {
    const loss = integratedExpectedLoss(85, 1417, 94, 1408)
    assert.ok(loss.shipB < loss.shipA)
  })
})

describe("betaPdf", () => {
  it("integrates to one", () => {
    let total = 0
    const steps = 20000
    for (let index = 0; index < steps; index += 1) total += betaPdf((index + 0.5) / steps, 9, 92) / steps
    assert.ok(Math.abs(total - 1) < 1e-6)
  })
})
