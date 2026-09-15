import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { analyze } from "../src/core/analyze.ts"
import { probabilityBBeatsA } from "../src/core/math.ts"

const WEB_DEFAULT = { visitorsA: 12000, conversionsA: 660, visitorsB: 11850, conversionsB: 714 }

describe("analyze matches the web tool on its default example", () => {
  const result = analyze(WEB_DEFAULT)

  it("posterior parameters", () => {
    assert.deepEqual(result.variants.A.posterior, [661, 11341])
    assert.deepEqual(result.variants.B.posterior, [715, 11137])
  })

  it("closed-form probability B beats A", () => {
    assert.ok(Math.abs(result.probability.bBeatsA - 0.9591138673472563) < 1e-12)
    assert.ok(Math.abs(result.probability.aBeatsB - (1 - 0.9591138673472563)) < 1e-12)
  })

  it("monte carlo summaries are bit-for-bit stable", () => {
    assert.equal(result.probability.meaningfulLift, 0.46416666666666667)
    assert.equal(result.probability.meaningfulHarm, 0.00016666666666666666)
    assert.equal(result.probability.harmful, 0.04058333333333333)
    assert.ok(Math.abs(result.expectedLoss.shipB - 0.00004961737918941582) < 1e-15)
    assert.ok(Math.abs(result.expectedLoss.shipA - 0.005279624093807332) < 1e-15)
    assert.ok(Math.abs(result.effect.relativeLiftCI95[0] - -0.011656544416891056) < 1e-15)
    assert.ok(Math.abs(result.effect.relativeLiftCI95[1] - 0.21302107014046556) < 1e-15)
  })

  it("decision and sample-size context", () => {
    assert.equal(result.decision.status, "continue")
    assert.equal(result.decision.label, "Continue test")
    assert.equal(result.decision.evidence, "low")
    assert.equal(result.decision.maturity, "building")
    assert.equal(result.decision.bayesActionNow, "B")
    assert.equal(result.sampleSize.requiredPerVariant, 25636)
    assert.equal(result.sampleSize.additionalPerVariant, 13786)
    assert.ok(Math.abs(result.frequentist.pValueTwoSided - 0.08170925754980063) < 1e-12)
  })

  it("waiting scenarios", () => {
    assert.deepEqual(
      result.waiting.map((scenario) => scenario.extraPerVariant),
      [1000, 2000, 5000, 10000]
    )
    assert.ok(Math.abs((result.waiting[2]?.valueOfWaiting ?? 0) - 0.000021125966250034352) < 1e-15)
  })

  it("share url reproduces the web tool state", () => {
    assert.equal(
      result.shareUrl,
      "https://www.joebrundage.com/tools/bayesian-ab-test?visitorsA=12000&conversionsA=660&visitorsB=11850&conversionsB=714&thresholdPercent=95&meaningfulLiftPercent=10"
    )
  })

  it("chart is opt-in", () => {
    assert.equal(result.chart, undefined)
    const withChart = analyze({ ...WEB_DEFAULT, includeChart: true })
    assert.equal(withChart.chart?.length, 96)
  })
})

describe("analyze edge cases", () => {
  it("is deterministic across calls", () => {
    const first = analyze(WEB_DEFAULT)
    const second = analyze(WEB_DEFAULT)
    assert.deepEqual(first, second)
  })

  it("handles zero conversions", () => {
    const result = analyze({ visitorsA: 100, conversionsA: 0, visitorsB: 100, conversionsB: 5 })
    assert.equal(result.effect.observedRelativeLift, null)
    assert.ok(result.probability.bBeatsA > 0.9)
  })

  it("closed form agrees with symmetry", () => {
    const p = probabilityBBeatsA(661, 11341, 715, 11137)
    const q = probabilityBBeatsA(715, 11137, 661, 11341)
    assert.ok(Math.abs(p + q - 1) < 1e-9)
  })

  it("ships B when the lift clearly clears the threshold", () => {
    const result = analyze({ visitorsA: 50000, conversionsA: 2500, visitorsB: 50000, conversionsB: 3200 })
    assert.equal(result.decision.status, "ship_b")
  })
})
