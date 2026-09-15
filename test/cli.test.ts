import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { CliError, parseCliArgs } from "../src/cli/args.ts"
import { run, type Io } from "../src/cli/main.ts"

const WEB_DEFAULT = ["--visitors-a", "12000", "--conversions-a", "660", "--visitors-b", "11850", "--conversions-b", "714"]

function capture(isTty: boolean): Io & { out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { out, err, isTty, stdout: (text) => out.push(text), stderr: (text) => err.push(text) }
}

describe("argument parsing", () => {
  it("parses analyze with defaults", () => {
    const parsed = parseCliArgs(["analyze", ...WEB_DEFAULT])
    assert.equal(parsed.kind, "analyze")
    if (parsed.kind !== "analyze") return
    assert.equal(parsed.args.threshold, 0.95)
    assert.equal(parsed.args.minEffect, 0.1)
    assert.equal(parsed.args.derivedFrom, null)
  })

  it("accepts commas, percent signs and rates", () => {
    const parsed = parseCliArgs(["analyze", "--visitors-a", "12,000", "--conversions-a", "660", "--visitors-b", "10000", "--rate-b", "6.1%", "--threshold", "90%", "--min-effect", "5"])
    assert.equal(parsed.kind, "analyze")
    if (parsed.kind !== "analyze") return
    assert.equal(parsed.args.visitorsA, 12000)
    assert.equal(parsed.args.conversionsB, 610)
    assert.deepEqual(parsed.args.derivedFrom, { rateB: 0.061 })
    assert.equal(parsed.args.threshold, 0.9)
    assert.equal(parsed.args.minEffect, 0.05)
  })

  it("treats bare rates above 1 as percents and at or below 1 as fractions", () => {
    const percentForm = parseCliArgs(["plan", "--baseline", "5.5", "--min-effect", "10"])
    const fractionForm = parseCliArgs(["plan", "--baseline", "0.055", "--min-effect", "10"])
    assert.equal(percentForm.kind, "plan")
    assert.equal(fractionForm.kind, "plan")
    if (percentForm.kind !== "plan" || fractionForm.kind !== "plan") return
    assert.equal(percentForm.args.baseline, 0.055)
    assert.equal(fractionForm.args.baseline, 0.055)
  })

  it("rejects conversions above visitors with the field named", () => {
    assert.throws(
      () => parseCliArgs(["analyze", "--visitors-a", "1000", "--conversions-a", "1200", "--visitors-b", "1000", "--conversions-b", "50"]),
      (error: unknown) => error instanceof CliError && error.field === "conversions-a" && /1200 > 1000/.test(error.message)
    )
  })

  it("rejects both a count and a rate for one variant", () => {
    assert.throws(
      () => parseCliArgs(["analyze", ...WEB_DEFAULT, "--rate-b", "6%"]),
      (error: unknown) => error instanceof CliError && /not both/.test(error.message)
    )
  })

  it("rejects unknown flags and commands", () => {
    assert.throws(() => parseCliArgs(["analyze", ...WEB_DEFAULT, "--bogus"]), CliError)
    assert.throws(() => parseCliArgs(["analyse", ...WEB_DEFAULT]), CliError)
    assert.throws(() => parseCliArgs(["analyze", "12000/660", ...WEB_DEFAULT]), CliError)
  })

  it("requires daily visitors for project and validates the stop rule", () => {
    assert.throws(() => parseCliArgs(["project", ...WEB_DEFAULT]), (error: unknown) => error instanceof CliError && error.field === "daily-visitors")
    assert.throws(() => parseCliArgs(["project", ...WEB_DEFAULT, "--daily-visitors", "1500", "--stop-rule", "fast"]), CliError)
    const parsed = parseCliArgs(["project", ...WEB_DEFAULT, "--daily-visitors", "1500", "--stop-rule", "loss", "--max-loss", "0.02"])
    assert.equal(parsed.kind, "project")
    if (parsed.kind !== "project") return
    assert.equal(parsed.args.maxLoss, 0.0002)
    assert.equal(parsed.args.horizonDays, 28)
  })

  it("routes help, version and schema", () => {
    assert.equal(parseCliArgs([]).kind, "help")
    assert.equal(parseCliArgs(["--help"]).kind, "help")
    assert.equal(parseCliArgs(["analyze", "--help"]).kind, "help")
    assert.equal(parseCliArgs(["--version"]).kind, "version")
    const schema = parseCliArgs(["schema", "project"])
    assert.equal(schema.kind, "schema")
    if (schema.kind === "schema") assert.equal(schema.target, "project")
  })
})

describe("run", () => {
  it("prints human output on a tty and json when piped", () => {
    const tty = capture(true)
    assert.equal(run(["analyze", ...WEB_DEFAULT], tty), 0)
    const human = tty.out.join("")
    assert.match(human, /^Bayesian A\/B test/)
    assert.match(human, /Decision {12}Continue test/)
    assert.match(human, /P\(B beats A\) +95\.91%/)
    assert.match(human, /Share {2}https:\/\/www\.joebrundage\.com/)

    const piped = capture(false)
    assert.equal(run(["analyze", ...WEB_DEFAULT], piped), 0)
    const lines = piped.out.join("").trimEnd().split("\n")
    assert.equal(lines.length, 1)
    const payload = JSON.parse(lines[0] as string)
    assert.equal(payload.tool, "bayes-ab")
    assert.equal(payload.command, "analyze")
    assert.equal(payload.decision.status, "continue")
    assert.equal(payload.probability.bBeatsA, 0.959114)
    assert.equal(payload.chart, undefined)
    assert.equal(payload.inputs.derivedFrom, undefined)
  })

  it("brief mode is one line and echoes derived counts", () => {
    const io = capture(true)
    assert.equal(run(["analyze", "--visitors-a", "12000", "--conversions-a", "660", "--visitors-b", "10000", "--rate-b", "6.1%", "--brief"], io), 0)
    const text = io.out.join("").trimEnd()
    assert.equal(text.split("\n").length, 1)
    assert.match(text, /^Continue test · P\(B beats A\) 97\.13%/)
    assert.match(text, /B = 610\/10000 from --rate-b 6\.10%/)
  })

  it("json errors go to stdout with exit code 2", () => {
    const io = capture(false)
    const code = run(["analyze", "--visitors-a", "1000", "--conversions-a", "1200", "--visitors-b", "1000", "--conversions-b", "50"], io)
    assert.equal(code, 2)
    const payload = JSON.parse(io.out.join(""))
    assert.equal(payload.error.code, "invalid_input")
    assert.equal(payload.error.field, "conversions-a")
  })

  it("human errors go to stderr", () => {
    const io = capture(true)
    const code = run(["analyze", "--visitors-a", "1000"], io)
    assert.equal(code, 2)
    assert.equal(io.out.length, 0)
    assert.match(io.err.join(""), /^error {2}Variant A needs/)
  })

  it("project renders and reports json", () => {
    const io = capture(false)
    assert.equal(run(["project", ...WEB_DEFAULT, "--daily-visitors", "1500", "--simulations", "300"], io), 0)
    const payload = JSON.parse(io.out.join(""))
    assert.equal(payload.command, "project")
    assert.equal(payload.inputs.stopRule, "lift")
    assert.equal(payload.inputs.samples, undefined)
    assert.ok(payload.decisionWithinHorizon >= 0 && payload.decisionWithinHorizon <= 1)

    const human = capture(true)
    assert.equal(run(["project", ...WEB_DEFAULT, "--daily-visitors", "1500", "--simulations", "300"], human), 0)
    assert.match(human.out.join(""), /Forward projection {2}1,500 visitors\/day per variant · 28-day horizon · 300 simulated futures/)
    assert.match(human.out.join(""), /Why so slow/)
  })

  it("plan renders and reports json", () => {
    const human = capture(true)
    assert.equal(run(["plan", "--baseline", "5.5%", "--min-effect", "10", "--daily-visitors", "1500"], human), 0)
    const text = human.out.join("")
    assert.match(text, /Visitors per variant {9}26,972/)
    assert.match(text, /26,972 per variant +18 days +← you are here/)

    const io = capture(false)
    assert.equal(run(["plan", "--baseline", "5.5%", "--min-effect", "10"], io), 0)
    const payload = JSON.parse(io.out.join(""))
    assert.equal(payload.perVariant, 26972)
    assert.equal(payload.days, null)
  })

  it("schema prints json schema", () => {
    const io = capture(true)
    assert.equal(run(["schema", "analyze"], io), 0)
    const payload = JSON.parse(io.out.join(""))
    assert.equal(payload.title, "bayes-ab analyze output")
    assert.ok(payload.properties.decision)
  })

  it("help mentions every command", () => {
    const io = capture(true)
    assert.equal(run(["--help"], io), 0)
    const text = io.out.join("")
    for (const command of ["analyze", "project", "plan", "schema"]) assert.match(text, new RegExp(`\\b${command}\\b`))
    assert.match(text, /READING THE OUTPUT/)
  })
})
