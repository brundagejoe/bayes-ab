import { analyze, type AnalyzeResult } from "../core/analyze.ts"
import { round } from "../core/math.ts"
import { plan, type PlanResult } from "../core/plan.ts"
import { project, type ProjectResult } from "../core/project.ts"
import { CliError, parseCliArgs, type OutputOptions } from "./args.ts"
import { helpText } from "./help.ts"
import { renderAnalyze, renderAnalyzeBrief } from "./render/analyze.ts"
import { renderPlan } from "./render/plan.ts"
import { renderProject, renderProjectBrief } from "./render/project.ts"
import { SCHEMAS } from "./schema.ts"

declare const __VERSION__: string | undefined
export const VERSION: string = typeof __VERSION__ === "string" ? __VERSION__ : "dev"

export type Io = {
  stdout: (text: string) => void
  stderr: (text: string) => void
  isTty: boolean
}

const JSON_DECIMALS = 6

function roundDeep<T>(value: T): T {
  if (typeof value === "number") return round(value, JSON_DECIMALS) as T
  if (Array.isArray(value)) return value.map(roundDeep) as T
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = roundDeep(inner)
    return out as T
  }
  return value
}

function emitJson(io: Io, output: OutputOptions, payload: unknown): void {
  const rounded = roundDeep(payload)
  io.stdout(output.pretty ? JSON.stringify(rounded, null, 2) + "\n" : JSON.stringify(rounded) + "\n")
}

function wantsJson(output: OutputOptions, io: Io): boolean {
  return output.json ?? !io.isTty
}

function envelope<T extends { inputs: object }>(command: string, result: T, derivedFrom: object | null): T & { tool: string; version: string; command: string } {
  const inputs = derivedFrom ? { ...result.inputs, derivedFrom } : result.inputs
  return { tool: "bayes-ab", version: VERSION, command, ...result, inputs }
}

function stripChart(result: AnalyzeResult): AnalyzeResult {
  const { chart, ...rest } = result
  return rest
}

export function run(argv: string[], io: Io): number {
  let parsed
  try {
    parsed = parseCliArgs(argv)
  } catch (error) {
    return reportError(error, io, argv.includes("--json") || !io.isTty)
  }

  if (parsed.kind === "help") {
    io.stdout(helpText(VERSION))
    return 0
  }
  if (parsed.kind === "version") {
    io.stdout(`${VERSION}\n`)
    return 0
  }

  const json = wantsJson(parsed.output, io)

  try {
    if (parsed.kind === "schema") {
      const payload = parsed.target ? SCHEMAS[parsed.target as "analyze" | "project" | "plan"] : SCHEMAS
      io.stdout(JSON.stringify(payload, null, 2) + "\n")
      return 0
    }

    if (parsed.kind === "analyze") {
      const { derivedFrom, ...inputs } = parsed.args
      const result: AnalyzeResult = analyze({ ...inputs, includeChart: parsed.output.includeChart })
      if (json) {
        emitJson(io, parsed.output, envelope("analyze", parsed.output.includeChart ? result : stripChart(result), derivedFrom))
      } else {
        io.stdout((parsed.output.brief ? renderAnalyzeBrief(result, derivedFrom) : renderAnalyze(result, derivedFrom)) + "\n")
      }
      return 0
    }

    if (parsed.kind === "project") {
      const { derivedFrom, samples: _samples, ...inputs } = parsed.args
      const result: ProjectResult = project(inputs)
      if (json) {
        emitJson(io, parsed.output, envelope("project", result, derivedFrom))
      } else {
        io.stdout((parsed.output.brief ? renderProjectBrief(result) : renderProject(result)) + "\n")
      }
      return 0
    }

    const result: PlanResult = plan(parsed.args)
    if (json) {
      emitJson(io, parsed.output, envelope("plan", result, null))
    } else {
      io.stdout(renderPlan(result) + "\n")
    }
    return 0
  } catch (error) {
    return reportError(error, io, json)
  }
}

function reportError(error: unknown, io: Io, json: boolean): number {
  const cliError = error instanceof CliError ? error : new CliError(error instanceof Error ? error.message : String(error), { code: "internal_error", exitCode: 1 })
  if (json) {
    io.stdout(JSON.stringify({ error: { code: cliError.code, message: cliError.message, field: cliError.field } }) + "\n")
  } else {
    io.stderr(`error  ${cliError.message}\n`)
    if (cliError.code === "missing_flag" || cliError.code === "unknown_flag" || cliError.code === "unknown_command" || cliError.code === "unexpected_argument") {
      io.stderr("Run bayes-ab --help for usage.\n")
    }
  }
  return cliError.exitCode
}
