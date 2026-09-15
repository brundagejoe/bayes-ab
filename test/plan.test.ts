import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { plan, requiredSamplePerVariant } from "../src/core/plan.ts"

describe("plan", () => {
  it("matches the web tool's sample size formula", () => {
    assert.equal(requiredSamplePerVariant({ baseline: 0.055, minEffect: 0.1 }), 26972)
    assert.equal(requiredSamplePerVariant({ baseline: 0.055, minEffect: 0.05 }), 107887)
    assert.equal(requiredSamplePerVariant({ baseline: 0.02, minEffect: 0.1 }), 76920)
  })

  it("converts to days and fills the sensitivity table", () => {
    const result = plan({ baseline: 0.055, minEffect: 0.1, dailyVisitors: 1500 })
    assert.equal(result.perVariant, 26972)
    assert.equal(result.total, 53944)
    assert.equal(result.days, 18)
    assert.deepEqual(result.sensitivity.map((row) => row.minEffect), [0.05, 0.1, 0.15, 0.2])
    assert.deepEqual(result.sensitivity.map((row) => row.perVariant), [107887, 26972, 11988, 6743])
    assert.deepEqual(result.sensitivity.map((row) => row.days), [72, 18, 8, 5])
  })

  it("adds an unusual effect to the sensitivity table in order", () => {
    const result = plan({ baseline: 0.055, minEffect: 0.12 })
    assert.deepEqual(result.sensitivity.map((row) => row.minEffect), [0.05, 0.1, 0.12, 0.15, 0.2])
    assert.equal(result.days, null)
  })
})
