import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

import { CliError, parseCliArgs } from "../src/cli/args.ts"
import { run, type Io } from "../src/cli/main.ts"
import { analyze } from "../src/core/analyze.ts"
import { makeDeterministicRandom, sampleStandardNormal } from "../src/core/math.ts"
import { analyzeSkeptical, calibrateLiftPrior, parsePastTestsCsv, type PastTest } from "../src/core/skeptical.ts"

const close = (actual: number, expected: number, tolerance: number, label = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`)

function capture(): Io & { out: string[] } {
  const out: string[] = []
  return { out, isTty: false, stdout: (text) => out.push(text), stderr: () => {} }
}

describe("analyzeSkeptical: worked examples", () => {
  it("matches the hand calculation for 200 vs 230 conversions in 10,000 each", () => {
    const result = analyzeSkeptical({ visitorsA: 10000, conversionsA: 200, visitorsB: 10000, conversionsB: 230 })
    close(result.effect.observedRelativeLift ?? NaN, 0.15, 1e-9, "observed")
    close(result.logLift.noise, Math.sqrt(1 / 200 - 1 / 10000 + 1 / 230 - 1 / 10000), 1e-12, "noise")
    assert.equal(result.weights.prior, 625)
    close(result.weights.dataShare, 0.149, 0.001, "data share")
    close(result.effect.relativeLift, 0.021, 0.001, "estimate")
    close(result.probability.bBeatsA, 0.714, 0.002, "P(B beats A)")
    assert.equal(result.weights.priorEquivalentConversionsPerVariant, 1250)
    assert.equal(result.weights.priorEquivalentVisitorsPerVariant, 62500)
    assert.equal(result.decision.status, "continue")
  })

  it("reproduces the 80,000-visitor sensitivity table", () => {
    const base = { visitorsA: 80000, conversionsA: 1600, visitorsB: 80000, conversionsB: 1760 }
    for (const [sd, lift, low, high, p] of [
      [0.03, 0.042, -0.003, 0.089, 0.967],
      [0.04, 0.057, 0.004, 0.112, 0.983],
      [0.06, 0.075, 0.014, 0.139, 0.992],
    ] as const) {
      const result = analyzeSkeptical({ ...base, liftPriorSd: sd })
      close(result.effect.relativeLift, lift, 0.001, `lift @${sd}`)
      close(result.effect.relativeLiftCI95[0], low, 0.001, `low @${sd}`)
      close(result.effect.relativeLiftCI95[1], high, 0.001, `high @${sd}`)
      close(result.probability.bBeatsA, p, 0.001, `P @${sd}`)
      assert.equal(result.decision.status, "ship_b")
    }
  })
})

describe("analyzeSkeptical: behavior", () => {
  it("approaches the flat-prior answer when the prior is very wide and the sample large", () => {
    const counts = { visitorsA: 200000, conversionsA: 4000, visitorsB: 200000, conversionsB: 4200 }
    const skeptical = analyzeSkeptical({ ...counts, liftPriorSd: 0.9 })
    const flat = analyze(counts)
    close(skeptical.probability.bBeatsA, flat.probability.bBeatsA, 0.005, "P(B beats A)")
    close(skeptical.effect.relativeLift, flat.effect.relativeLift, 0.003, "lift")
  })

  it("shrinks harder with a tighter prior", () => {
    const counts = { visitorsA: 10000, conversionsA: 200, visitorsB: 10000, conversionsB: 230 }
    const tight = analyzeSkeptical({ ...counts, liftPriorSd: 0.02 })
    const loose = analyzeSkeptical({ ...counts, liftPriorSd: 0.1 })
    assert.ok(tight.effect.relativeLift < loose.effect.relativeLift)
    assert.ok(tight.weights.dataShare < loose.weights.dataShare)
  })

  it("expected losses match Monte Carlo on the log-normal posterior", () => {
    const result = analyzeSkeptical({ visitorsA: 20000, conversionsA: 400, visitorsB: 20000, conversionsB: 430 })
    const { posteriorMean: m, posteriorSd: s } = result.logLift
    const random = makeDeterministicRandom(11)
    let lossB = 0
    let lossA = 0
    const draws = 400000
    for (let index = 0; index < draws; index += 1) {
      const lift = Math.exp(m + s * sampleStandardNormal(random)) - 1
      lossB += Math.max(0, -lift)
      lossA += Math.max(0, lift)
    }
    close(result.expectedLoss.shipBRelative, lossB / draws, 2e-4, "ship B")
    close(result.expectedLoss.shipARelative, lossA / draws, 2e-4, "keep A")
  })

  it("keeps A when B is clearly worse", () => {
    const result = analyzeSkeptical({ visitorsA: 300000, conversionsA: 6600, visitorsB: 300000, conversionsB: 6000 })
    assert.equal(result.decision.status, "keep_a")
  })

  it("calls no meaningful difference only once the data outweighs the prior", () => {
    const large = analyzeSkeptical({ visitorsA: 2_000_000, conversionsA: 40000, visitorsB: 2_000_000, conversionsB: 40010 })
    assert.equal(large.decision.status, "no_meaningful_difference")
    /* A tight prior and little data: the prior alone squeezes the interval
       inside the band, which must not count as evidence of no effect. */
    const small = analyzeSkeptical({ visitorsA: 2000, conversionsA: 40, visitorsB: 2000, conversionsB: 41, liftPriorSd: 0.01 })
    assert.equal(small.decision.checks.withinNoEffectBand, false)
    assert.equal(small.decision.status, "continue")
  })

  it("holds back a ship when the loss rule is not met", () => {
    const result = analyzeSkeptical({ visitorsA: 80000, conversionsA: 1600, visitorsB: 80000, conversionsB: 1760, liftPriorSd: 0.03, maxRelativeLoss: 0.0001 })
    assert.equal(result.decision.checks.bBeatsAReached, true)
    assert.equal(result.decision.checks.shipBLossAcceptable, false)
    assert.equal(result.decision.status, "continue")
  })

  it("flags decisions that change with the prior spread", () => {
    const result = analyzeSkeptical({ visitorsA: 80000, conversionsA: 1600, visitorsB: 80000, conversionsB: 1745 })
    assert.equal(result.sensitivity.rows.length, 3)
    assert.equal(result.sensitivity.robust, new Set(result.sensitivity.rows.map((row) => row.status)).size === 1)
    if (!result.sensitivity.robust) assert.ok(result.warnings.includes("decision_sensitive_to_prior"))
  })

  it("handles zero conversions and warns about small counts", () => {
    const result = analyzeSkeptical({ visitorsA: 500, conversionsA: 0, visitorsB: 500, conversionsB: 3 })
    assert.ok(Number.isFinite(result.effect.relativeLift))
    assert.ok(result.warnings.includes("zero_or_all_conversions"))
    assert.ok(result.warnings.includes("few_conversions"))
  })

  it("draws a chart whose curves peak at 1", () => {
    const result = analyzeSkeptical({ visitorsA: 10000, conversionsA: 200, visitorsB: 10000, conversionsB: 230, includeChart: true })
    assert.ok(result.chart && result.chart.length === 121)
    close(Math.max(...result.chart.map((point) => point.posterior)), 1, 0.01, "posterior peak")
    close(Math.max(...result.chart.map((point) => point.prior)), 1, 0.01, "prior peak")
  })

  it("builds a share URL for the web tool", () => {
    const result = analyzeSkeptical({ visitorsA: 10000, conversionsA: 200, visitorsB: 10000, conversionsB: 230 })
    assert.match(result.shareUrl, /^https:\/\/www\.joebrundage\.com\/tools\/skeptical-ab-test\?/)
    assert.match(result.shareUrl, /liftPriorSdPercent=4&/)
  })

  it("rejects invalid inputs", () => {
    assert.throws(() => analyzeSkeptical({ visitorsA: 100, conversionsA: 200, visitorsB: 100, conversionsB: 1 }), RangeError)
    assert.throws(() => analyzeSkeptical({ visitorsA: 100, conversionsA: 5, visitorsB: 100, conversionsB: 5, liftPriorSd: 0 }), RangeError)
  })
})

describe("calibrateLiftPrior", () => {
  function simulate(trueSd: number, count: number, visitors: number, seed: number): PastTest[] {
    const random = makeDeterministicRandom(seed)
    const binomial = (n: number, p: number) => Math.max(0, Math.round(n * p + Math.sqrt(n * p * (1 - p)) * sampleStandardNormal(random)))
    return Array.from({ length: count }, () => {
      const lift = trueSd * sampleStandardNormal(random)
      return { visitorsA: visitors, conversionsA: binomial(visitors, 0.02), visitorsB: visitors, conversionsB: binomial(visitors, 0.02 * Math.exp(lift)) }
    })
  }

  it("recovers the spread of true lifts", () => {
    const result = calibrateLiftPrior(simulate(0.04, 300, 100000, 3))
    close(result.liftPriorSd, 0.04, 0.008, "spread")
    assert.equal(result.floored, false)
    assert.ok(result.observedSd > result.liftPriorSd, "observed spread includes noise")
  })

  it("floors the spread when lifts are pure noise", () => {
    const result = calibrateLiftPrior(simulate(0, 60, 50000, 5))
    assert.ok(result.liftPriorSd >= 0.005)
    if (result.floored) assert.ok(result.warnings.includes("no_spread_beyond_noise"))
  })

  it("warns with few tests and refuses fewer than three", () => {
    assert.ok(calibrateLiftPrior(simulate(0.04, 5, 50000, 9)).warnings.includes("few_tests"))
    assert.throws(() => calibrateLiftPrior(simulate(0.04, 2, 50000, 9)), RangeError)
  })

  it("parses CSV with a header, comments and quoted thousands", () => {
    const tests = parsePastTestsCsv('visitorsA,conversionsA,visitorsB,conversionsB\n# Q1\n10000,200,10000,230\n"12,000",240,"12,000",250\n\n')
    assert.deepEqual(tests, [
      { visitorsA: 10000, conversionsA: 200, visitorsB: 10000, conversionsB: 230 },
      { visitorsA: 12000, conversionsA: 240, visitorsB: 12000, conversionsB: 250 },
    ])
    assert.throws(() => parsePastTestsCsv("10000,200,10000\n"), RangeError)
    assert.throws(() => parsePastTestsCsv("10000,200,10000,230\nabc,1,2,3\n"), RangeError)
  })
})

describe("CLI: skeptical and calibrate", () => {
  const FLAGS = ["--visitors-a", "10000", "--conversions-a", "200", "--visitors-b", "10000", "--conversions-b", "230"]

  it("parses skeptical defaults and flags", () => {
    const defaults = parseCliArgs(["skeptical", ...FLAGS])
    assert.ok(defaults.kind === "skeptical")
    assert.equal(defaults.args.liftPriorSd, 0.04)
    assert.equal(defaults.args.minEffect, 0.05)
    assert.equal(defaults.args.maxRelativeLoss, 0.001)
    const custom = parseCliArgs(["skeptical", ...FLAGS, "--lift-prior-sd", "3%", "--max-relative-loss", "0.5", "--min-effect", "2"])
    assert.ok(custom.kind === "skeptical")
    assert.equal(custom.args.liftPriorSd, 0.03)
    assert.equal(custom.args.maxRelativeLoss, 0.005)
    assert.equal(custom.args.minEffect, 0.02)
    assert.throws(() => parseCliArgs(["skeptical", ...FLAGS, "--lift-prior-sd", "0"]), CliError)
  })

  it("emits JSON and a human readout", () => {
    const io = capture()
    assert.equal(run(["skeptical", ...FLAGS, "--json"], io), 0)
    const payload = JSON.parse(io.out.join(""))
    assert.equal(payload.command, "skeptical")
    assert.equal(payload.decision.status, "continue")
    assert.equal(payload.chart, undefined)

    const human = capture()
    assert.equal(run(["skeptical", ...FLAGS], { ...human, isTty: true }), 0)
    assert.match(human.out.join(""), /How the prior pulled the estimate/)
    assert.match(human.out.join(""), /Sensitivity/)
  })

  it("calibrates from a CSV file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bayes-ab-"))
    const file = join(dir, "past.csv")
    writeFileSync(file, "visitorsA,conversionsA,visitorsB,conversionsB\n" + [
      "50000,1000,50000,1080", "50000,1000,50000,960", "50000,1000,50000,1010",
      "50000,1000,50000,1150", "50000,1000,50000,940",
    ].join("\n"))
    const io = capture()
    assert.equal(run(["calibrate", "--file", file, "--json"], io), 0)
    const payload = JSON.parse(io.out.join(""))
    assert.equal(payload.command, "calibrate")
    assert.equal(payload.tests, 5)
    assert.ok(payload.liftPriorSd > 0)

    const missing = capture()
    assert.equal(run(["calibrate", "--file", join(dir, "nope.csv"), "--json"], missing), 2)
  })

  it("prints the new schemas", () => {
    for (const target of ["skeptical", "calibrate"]) {
      const io = capture()
      assert.equal(run(["schema", target], io), 0)
      assert.match(JSON.parse(io.out.join("")).title, new RegExp(target))
    }
  })
})
