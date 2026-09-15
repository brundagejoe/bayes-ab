import { parseArgs } from "node:util"

import { DEFAULT_MIN_EFFECT, DEFAULT_SAMPLES, DEFAULT_THRESHOLD } from "../core/analyze.ts"
import { DEFAULT_HORIZON_DAYS, DEFAULT_MAX_LOSS, DEFAULT_SIMULATIONS, type StopRule } from "../core/project.ts"

export class CliError extends Error {
  code: string
  field: string | null
  exitCode: number

  constructor(message: string, { code = "invalid_input", field = null, exitCode = 2 }: { code?: string; field?: string | null; exitCode?: number } = {}) {
    super(message)
    this.code = code
    this.field = field
    this.exitCode = exitCode
  }
}

export type Command = "analyze" | "project" | "plan" | "schema"
export const COMMANDS: Command[] = ["analyze", "project", "plan", "schema"]

export type OutputOptions = {
  json: boolean | null
  pretty: boolean
  brief: boolean
  includeChart: boolean
}

export type VariantArgs = {
  visitorsA: number
  conversionsA: number
  visitorsB: number
  conversionsB: number
  derivedFrom: { rateA?: number; rateB?: number } | null
}

export type AnalyzeArgs = VariantArgs & {
  threshold: number
  minEffect: number
  samples: number
  seed: number | null
}

export type ProjectArgs = AnalyzeArgs & {
  dailyVisitors: number
  horizonDays: number
  stopRule: StopRule
  maxLoss: number
  simulations: number
}

export type PlanArgs = {
  baseline: number
  minEffect: number
  power: number
  alpha: number
  dailyVisitors: number | null
}

export type ParsedArgs =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "schema"; target: Command | null; output: OutputOptions }
  | { kind: "analyze"; args: AnalyzeArgs; output: OutputOptions }
  | { kind: "project"; args: ProjectArgs; output: OutputOptions }
  | { kind: "plan"; args: PlanArgs; output: OutputOptions }

const OPTIONS = {
  "visitors-a": { type: "string" },
  "conversions-a": { type: "string" },
  "rate-a": { type: "string" },
  "visitors-b": { type: "string" },
  "conversions-b": { type: "string" },
  "rate-b": { type: "string" },
  threshold: { type: "string" },
  "min-effect": { type: "string" },
  "daily-visitors": { type: "string" },
  horizon: { type: "string" },
  "stop-rule": { type: "string" },
  "max-loss": { type: "string" },
  simulations: { type: "string" },
  samples: { type: "string" },
  seed: { type: "string" },
  baseline: { type: "string" },
  power: { type: "string" },
  alpha: { type: "string" },
  json: { type: "boolean" },
  pretty: { type: "boolean" },
  brief: { type: "boolean" },
  "include-chart": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const

type RawValues = { [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K]["type"] extends "boolean" ? boolean : string }

function cleanNumber(value: string): string {
  return value.trim().replace(/[,_]/g, "")
}

function parseCount(flag: string, value: string | undefined, { min = 0 }: { min?: number } = {}): number {
  if (value === undefined) throw new CliError(`Missing required flag --${flag}.`, { code: "missing_flag", field: flag })
  const cleaned = cleanNumber(value)
  if (!/^\d+$/.test(cleaned)) throw new CliError(`--${flag} must be a whole number, got "${value}".`, { field: flag })
  const parsed = Number(cleaned)
  if (!Number.isSafeInteger(parsed)) throw new CliError(`--${flag} is too large.`, { field: flag })
  if (parsed < min) throw new CliError(`--${flag} must be at least ${min}.`, { field: flag })
  return parsed
}

function parseNumber(flag: string, value: string): number {
  const cleaned = cleanNumber(value).replace(/%$/, "")
  const parsed = Number(cleaned)
  if (cleaned === "" || !Number.isFinite(parsed)) throw new CliError(`--${flag} must be a number, got "${value}".`, { field: flag })
  return parsed
}

/** Threshold and min-effect are always percents, with or without the % sign: 95, 95%, 12.5. */
function parsePercentFlag(flag: string, value: string): number {
  return parseNumber(flag, value) / 100
}

/** Rates accept 6.1%, 6.1 (percent when above 1) or 0.061 (fraction when 1 or below). */
function parseRateFlag(flag: string, value: string): number {
  const parsed = parseNumber(flag, value)
  if (value.trim().endsWith("%")) return parsed / 100
  return parsed > 1 ? parsed / 100 : parsed
}

function parseVariant(values: RawValues, letter: "a" | "b"): { visitors: number; conversions: number; rate: number | null } {
  const visitorsFlag = `visitors-${letter}` as const
  const conversionsFlag = `conversions-${letter}` as const
  const rateFlag = `rate-${letter}` as const
  const visitors = parseCount(visitorsFlag, values[visitorsFlag], { min: 1 })
  const conversionsRaw = values[conversionsFlag]
  const rateRaw = values[rateFlag]
  if (conversionsRaw !== undefined && rateRaw !== undefined) {
    throw new CliError(`Give either --${conversionsFlag} or --${rateFlag}, not both.`, { field: conversionsFlag })
  }
  if (conversionsRaw === undefined && rateRaw === undefined) {
    throw new CliError(`Variant ${letter.toUpperCase()} needs --${conversionsFlag} or --${rateFlag}.`, { code: "missing_flag", field: conversionsFlag })
  }
  if (rateRaw !== undefined) {
    const rate = parseRateFlag(rateFlag, rateRaw)
    if (rate < 0 || rate > 1) throw new CliError(`--${rateFlag} must be between 0% and 100%.`, { field: rateFlag })
    return { visitors, conversions: Math.round(visitors * rate), rate }
  }
  const conversions = parseCount(conversionsFlag, conversionsRaw)
  if (conversions > visitors) {
    throw new CliError(
      `Conversions cannot exceed visitors (variant ${letter.toUpperCase()}: ${conversions} > ${visitors}).`,
      { field: conversionsFlag }
    )
  }
  return { visitors, conversions, rate: null }
}

function parseVariants(values: RawValues): VariantArgs {
  const a = parseVariant(values, "a")
  const b = parseVariant(values, "b")
  const derivedFrom: VariantArgs["derivedFrom"] = a.rate !== null || b.rate !== null ? {} : null
  if (derivedFrom && a.rate !== null) derivedFrom.rateA = a.rate
  if (derivedFrom && b.rate !== null) derivedFrom.rateB = b.rate
  return { visitorsA: a.visitors, conversionsA: a.conversions, visitorsB: b.visitors, conversionsB: b.conversions, derivedFrom }
}

function parseThreshold(values: RawValues): number {
  if (values.threshold === undefined) return DEFAULT_THRESHOLD
  const threshold = parsePercentFlag("threshold", values.threshold)
  if (threshold <= 0.5 || threshold >= 1) throw new CliError("--threshold must be a percent between 50 and 100, exclusive.", { field: "threshold" })
  return threshold
}

function parseMinEffect(values: RawValues): number {
  if (values["min-effect"] === undefined) return DEFAULT_MIN_EFFECT
  const minEffect = parsePercentFlag("min-effect", values["min-effect"])
  if (minEffect < 0 || minEffect >= 1) throw new CliError("--min-effect must be a percent between 0 and 100.", { field: "min-effect" })
  return minEffect
}

function parseAnalyzeArgs(values: RawValues): AnalyzeArgs {
  const samples = values.samples === undefined ? DEFAULT_SAMPLES : parseCount("samples", values.samples, { min: 100 })
  const seed = values.seed === undefined ? null : parseCount("seed", values.seed)
  return { ...parseVariants(values), threshold: parseThreshold(values), minEffect: parseMinEffect(values), samples, seed }
}

function parseStopRule(value: string | undefined): StopRule {
  if (value === undefined) return "lift"
  if (value === "lift" || value === "superiority" || value === "loss") return value
  throw new CliError(`--stop-rule must be lift, superiority or loss, got "${value}".`, { field: "stop-rule" })
}

function parseProjectArgs(values: RawValues): ProjectArgs {
  const base = parseAnalyzeArgs(values)
  const dailyVisitors = parseCount("daily-visitors", values["daily-visitors"], { min: 1 })
  const horizonDays = values.horizon === undefined ? DEFAULT_HORIZON_DAYS : parseCount("horizon", values.horizon, { min: 1 })
  if (horizonDays > 3650) throw new CliError("--horizon must be 3650 days or fewer.", { field: "horizon" })
  const stopRule = parseStopRule(values["stop-rule"])
  const maxLoss = values["max-loss"] === undefined ? DEFAULT_MAX_LOSS : parseNumber("max-loss", values["max-loss"]) / 100
  if (maxLoss < 0) throw new CliError("--max-loss must be zero or more percentage points.", { field: "max-loss" })
  const simulations = values.simulations === undefined ? DEFAULT_SIMULATIONS : parseCount("simulations", values.simulations, { min: 100 })
  return { ...base, dailyVisitors, horizonDays, stopRule, maxLoss, simulations }
}

function parsePlanArgs(values: RawValues): PlanArgs {
  if (values.baseline === undefined) throw new CliError("Missing required flag --baseline.", { code: "missing_flag", field: "baseline" })
  const baseline = parseRateFlag("baseline", values.baseline)
  if (baseline <= 0 || baseline >= 1) throw new CliError("--baseline must be between 0% and 100%, exclusive. Use 1% for one percent.", { field: "baseline" })
  if (values["min-effect"] === undefined) throw new CliError("Missing required flag --min-effect.", { code: "missing_flag", field: "min-effect" })
  const minEffect = parsePercentFlag("min-effect", values["min-effect"])
  if (minEffect <= 0 || minEffect >= 1) throw new CliError("--min-effect must be a percent between 0 and 100, exclusive.", { field: "min-effect" })
  const power = values.power === undefined ? 0.8 : parsePercentFlag("power", values.power)
  if (power <= 0 || power >= 1) throw new CliError("--power must be a percent between 0 and 100, exclusive.", { field: "power" })
  const alpha = values.alpha === undefined ? 0.05 : parsePercentFlag("alpha", values.alpha)
  if (alpha <= 0 || alpha >= 1) throw new CliError("--alpha must be a percent between 0 and 100, exclusive.", { field: "alpha" })
  const dailyVisitors = values["daily-visitors"] === undefined ? null : parseCount("daily-visitors", values["daily-visitors"], { min: 1 })
  return { baseline, minEffect, power, alpha, dailyVisitors }
}

function parseOutput(values: RawValues): OutputOptions {
  return {
    json: values.json ? true : null,
    pretty: Boolean(values.pretty),
    brief: Boolean(values.brief),
    includeChart: Boolean(values["include-chart"]),
  }
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new CliError(message.replace(/^.*?: /, ""), { code: "unknown_flag" })
  }
  const values = parsed.values as RawValues
  const [command, ...rest] = parsed.positionals

  if (values.version) return { kind: "version" }
  if (values.help || command === undefined || command === "help") return { kind: "help" }
  if (!COMMANDS.includes(command as Command)) {
    throw new CliError(`Unknown command "${command}". Expected one of: ${COMMANDS.join(", ")}.`, { code: "unknown_command" })
  }
  const output = parseOutput(values)

  if (command === "schema") {
    const target = rest[0]
    if (target !== undefined && !["analyze", "project", "plan"].includes(target)) {
      throw new CliError(`schema takes analyze, project or plan, got "${target}".`, { code: "unknown_command" })
    }
    return { kind: "schema", target: (target as Command | undefined) ?? null, output }
  }
  if (rest.length > 0) {
    throw new CliError(`Unexpected argument "${rest[0]}". Inputs are given as flags, e.g. --visitors-a 12000.`, { code: "unexpected_argument" })
  }
  if (command === "analyze") return { kind: "analyze", args: parseAnalyzeArgs(values), output }
  if (command === "project") return { kind: "project", args: parseProjectArgs(values), output }
  return { kind: "plan", args: parsePlanArgs(values), output }
}
