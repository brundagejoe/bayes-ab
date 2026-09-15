import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { project } from "../src/core/project.ts"

const WEB_DEFAULT = { visitorsA: 12000, conversionsA: 660, visitorsB: 11850, conversionsB: 714 }

describe("project", () => {
  it("is deterministic and reports a sensible distribution under the lift rule", () => {
    const first = project({ ...WEB_DEFAULT, dailyVisitors: 1500, horizonDays: 28, simulations: 500 })
    const second = project({ ...WEB_DEFAULT, dailyVisitors: 1500, horizonDays: 28, simulations: 500 })
    assert.deepEqual(first, second)
    assert.equal(first.alreadyDecided, false)
    assert.ok(first.decisionWithinHorizon > 0.05 && first.decisionWithinHorizon < 0.5)
    assert.equal(first.outcomes.keepA, 0)
    assert.ok(Math.abs(first.outcomes.shipB + first.outcomes.undecided - 1) < 1e-9)
    assert.equal(first.diagnostic, "lift_near_threshold")
    assert.deepEqual(first.cumulative.map((point) => point.day), [7, 14, 21, 28])
    assert.equal(first.cumulative[3]?.p, first.decisionWithinHorizon)
  })

  it("decides more often with a smaller meaningful effect", () => {
    const strict = project({ ...WEB_DEFAULT, dailyVisitors: 1500, simulations: 500 })
    const relaxed = project({ ...WEB_DEFAULT, dailyVisitors: 1500, simulations: 500, minEffect: 0.05 })
    assert.ok(relaxed.decisionWithinHorizon > strict.decisionWithinHorizon)
    assert.equal(relaxed.diagnostic, null)
  })

  it("reports already decided when the superiority rule is met today", () => {
    const result = project({ ...WEB_DEFAULT, dailyVisitors: 1500, stopRule: "superiority" })
    assert.equal(result.alreadyDecided, true)
    assert.equal(result.decisionNow, "ship_b")
    assert.equal(result.decisionWithinHorizon, 1)
  })

  it("loss rule respects max-loss", () => {
    const tight = project({ ...WEB_DEFAULT, dailyVisitors: 1500, stopRule: "loss", maxLoss: 0.000001, simulations: 300 })
    assert.equal(tight.alreadyDecided, false)
    assert.equal(tight.inputs.maxLoss, 0.000001)
    const loose = project({ ...WEB_DEFAULT, dailyVisitors: 1500, stopRule: "loss", maxLoss: 0.001 })
    assert.equal(loose.alreadyDecided, true)
  })

  it("short horizons produce a single checkpoint", () => {
    const result = project({ ...WEB_DEFAULT, dailyVisitors: 1500, horizonDays: 5, simulations: 200 })
    assert.deepEqual(result.cumulative.map((point) => point.day), [5])
  })

  it("explicit seed changes the draw but not the shape", () => {
    const a = project({ ...WEB_DEFAULT, dailyVisitors: 1500, simulations: 300, seed: 1 })
    const b = project({ ...WEB_DEFAULT, dailyVisitors: 1500, simulations: 300, seed: 2 })
    assert.notEqual(a.inputs.seed, b.inputs.seed)
    assert.ok(Math.abs(a.decisionWithinHorizon - b.decisionWithinHorizon) < 0.2)
  })
})
