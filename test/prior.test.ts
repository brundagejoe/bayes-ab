import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { CliError, parseCliArgs } from "../src/cli/args.ts"
import { run, type Io } from "../src/cli/main.ts"
import { analyze } from "../src/core/analyze.ts"
import { makeDeterministicRandom, probabilityBBeatsA, regularizedIncompleteBeta, sampleBeta } from "../src/core/math.ts"
import { project } from "../src/core/project.ts"

const WEB_DEFAULT = { visitorsA: 12000, conversionsA: 660, visitorsB: 11850, conversionsB: 714 }
const WEB_DEFAULT_FLAGS = ["--visitors-a", "12000", "--conversions-a", "660", "--visitors-b", "11850", "--conversions-b", "714"]

function capture(): Io & { out: string[] } {
  const out: string[] = []
  return { out, isTty: false, stdout: (text) => out.push(text), stderr: () => {} }
}

describe("custom priors", () => {
  it("an explicit Beta(1, 1) is identical to the default", () => {
    assert.deepEqual(analyze({ ...WEB_DEFAULT, prior: [1, 1] }), analyze(WEB_DEFAULT))
    assert.equal(analyze(WEB_DEFAULT).shareUrl.includes("prior"), false)
  })

  it("adds the prior to each variant's posterior", () => {
    const result = analyze({ ...WEB_DEFAULT, prior: [55, 945] })
    assert.deepEqual(result.inputs.prior, [55, 945])
    assert.deepEqual(result.variants.A.posterior, [715, 12285])
    assert.deepEqual(result.variants.B.posterior, [769, 12081])
    assert.ok(Math.abs(result.probability.bBeatsA - probabilityBBeatsA(715, 12285, 769, 12081)) < 1e-12)
    assert.match(result.shareUrl, /priorAlpha=55&priorBeta=945$/)
  })

  it("a strong shared prior shrinks the lift toward zero", () => {
    const flat = analyze(WEB_DEFAULT)
    const strong = analyze({ ...WEB_DEFAULT, prior: [550, 9450] })
    assert.ok(Math.abs(strong.effect.relativeLift) < Math.abs(flat.effect.relativeLift))
    assert.ok(strong.probability.bBeatsA < flat.probability.bBeatsA)
  })

  it("accepts fractional priors such as Jeffreys", () => {
    const result = analyze({ ...WEB_DEFAULT, prior: [0.5, 0.5], includeChart: true })
    assert.deepEqual(result.variants.A.posterior, [660.5, 11340.5])
    assert.ok(result.probability.bBeatsA > 0.95 && result.probability.bBeatsA < 0.97)
    assert.ok(result.chart && result.chart.every((point) => Number.isFinite(point.densityA)))
  })

  it("rejects non-positive priors", () => {
    assert.throws(() => analyze({ ...WEB_DEFAULT, prior: [0, 1] }), RangeError)
    assert.throws(() => analyze({ ...WEB_DEFAULT, prior: [1, -2] }), RangeError)
    assert.throws(() => analyze({ ...WEB_DEFAULT, prior: [Number.NaN, 1] }), RangeError)
  })

  it("project carries the prior through", () => {
    const result = project({ ...WEB_DEFAULT, dailyVisitors: 1500, simulations: 200, prior: [2, 30] })
    assert.deepEqual(result.inputs.prior, [2, 30])
    assert.match(result.shareUrl, /priorAlpha=2&priorBeta=30$/)
  })
})

describe("P(B beats A) for fractional alphas", () => {
  it("numerical path agrees with the closed form", () => {
    for (const [a, b, c, d] of [
      [661, 11341, 715, 11137],
      [3, 10, 5, 8],
      [1, 1000, 2, 999],
      [201, 99800, 240, 99761],
    ] as const) {
      const exact = probabilityBBeatsA(a, b, c, d)
      const numeric = probabilityBBeatsA(a + 1e-9, b, c + 1e-9, d)
      assert.ok(Math.abs(exact - numeric) < 1e-8, `${a},${b},${c},${d}: ${exact} vs ${numeric}`)
    }
  })

  it("agrees with Monte Carlo on a skewed Jeffreys case", () => {
    const random = makeDeterministicRandom(7)
    let wins = 0
    const draws = 200000
    for (let index = 0; index < draws; index += 1) if (sampleBeta(2.5, 98.5, random) > sampleBeta(0.5, 100.5, random)) wins += 1
    assert.ok(Math.abs(probabilityBBeatsA(0.5, 100.5, 2.5, 98.5) - wins / draws) < 0.005)
    assert.ok(Math.abs(probabilityBBeatsA(0.5, 0.5, 0.5, 0.5) - 0.5) < 1e-6)
  })

  it("incomplete beta matches a closed form", () => {
    assert.ok(Math.abs(regularizedIncompleteBeta(0.3, 2, 3) - (1 - (0.7 ** 4 + 4 * 0.3 * 0.7 ** 3))) < 1e-12)
  })
})

describe("prior flags", () => {
  it("default to Beta(1, 1)", () => {
    const parsed = parseCliArgs(["analyze", ...WEB_DEFAULT_FLAGS])
    assert.ok(parsed.kind === "analyze")
    assert.deepEqual(parsed.args.prior, [1, 1])
  })

  it("parse and reach the JSON output", () => {
    const io = capture()
    assert.equal(run(["analyze", ...WEB_DEFAULT_FLAGS, "--prior-alpha", "0.5", "--prior-beta", "0.5", "--json"], io), 0)
    const payload = JSON.parse(io.out.join(""))
    assert.deepEqual(payload.inputs.prior, [0.5, 0.5])
    assert.deepEqual(payload.variants.A.posterior, [660.5, 11340.5])
  })

  it("reject zero and negatives", () => {
    assert.throws(() => parseCliArgs(["analyze", ...WEB_DEFAULT_FLAGS, "--prior-alpha", "0"]), CliError)
    assert.throws(() => parseCliArgs(["analyze", ...WEB_DEFAULT_FLAGS, "--prior-beta", "-1"]), CliError)
  })
})
