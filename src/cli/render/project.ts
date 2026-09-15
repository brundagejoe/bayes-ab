import type { ProjectResult } from "../../core/project.ts"
import { count, keyValueLines, percent, table, unsignedPoints } from "../format.ts"

function describeRule(result: ProjectResult): string {
  const { stopRule, threshold, minEffect, maxLoss } = result.inputs
  const t = percent(threshold, 0)
  if (stopRule === "superiority") return `P(B beats A) ≥ ${t}  or  P(A beats B) ≥ ${t}`
  if (stopRule === "loss") return `expected loss of the better variant ≤ ${unsignedPoints(maxLoss ?? 0)}`
  const e = percent(minEffect, 0)
  return `P(lift > +${e}) ≥ ${t}  or  P(lift < -${e}) ≥ ${t}`
}

function decisionLabel(decision: "ship_b" | "keep_a"): string {
  return decision === "ship_b" ? "Ship B" : "Keep A"
}

function diagnosticLines(result: ProjectResult): string[] {
  if (result.diagnostic !== "lift_near_threshold") return []
  const e = percent(result.inputs.minEffect, 0)
  return [
    "",
    `Why so slow   The estimated lift sits on the ±${e} meaningful-effect line.`,
    "              More data sharpens the estimate around that line instead of pushing it across.",
    "              Try a smaller --min-effect, or --stop-rule superiority to ask only whether B beats A.",
  ]
}

export function renderProjectBrief(result: ProjectResult): string {
  const { horizonDays, dailyVisitors } = result.inputs
  if (result.alreadyDecided && result.decisionNow) {
    return `Already decided today: ${decisionLabel(result.decisionNow)} under the ${result.inputs.stopRule} rule · no simulation needed`
  }
  const parts = [
    `P(decision within ${horizonDays} days) ${percent(result.decisionWithinHorizon, 0)}`,
    `Ship B ${percent(result.outcomes.shipB, 0)} · Keep A ${percent(result.outcomes.keepA, 0)}`,
    result.daysToDecision ? `median day ${result.daysToDecision.p50} if it decides (p90 day ${result.daysToDecision.p90})` : "no simulated future decided",
    `${count(dailyVisitors)}/day per variant`,
  ]
  return parts.join(" · ")
}

export function renderProject(result: ProjectResult): string {
  const { inputs } = result
  const lines: string[] = []
  lines.push(
    `Forward projection  ${count(inputs.dailyVisitors)} visitors/day per variant · ${inputs.horizonDays}-day horizon · ${count(inputs.simulations)} simulated futures`
  )
  lines.push(`Stopping rule       ${describeRule(result)}`)
  lines.push("")

  if (result.alreadyDecided && result.decisionNow) {
    lines.push(`Already decided     ${decisionLabel(result.decisionNow)}`)
    lines.push("")
    lines.push(`The ${inputs.stopRule} rule is already satisfied by today's data, so there is nothing to wait for.`)
    lines.push("Run analyze for the full readout.")
    lines.push(...diagnosticLines(result))
    return lines.join("\n")
  }

  lines.push(
    ...keyValueLines(
      [[`Chance of a decision within ${inputs.horizonDays} days`, percent(result.decisionWithinHorizon, 0)]],
      44
    )
  )
  lines.push(
    ...table([
      ["Ship B", percent(result.outcomes.shipB, 0)],
      ["Keep A", percent(result.outcomes.keepA, 0)],
      [`Still running at day ${inputs.horizonDays}`, percent(result.outcomes.undecided, 0)],
    ], "  ", 3)
  )
  lines.push("")

  if (result.daysToDecision) {
    lines.push("If it decides, when?")
    lines.push(
      ...table([
        ["25% of decisions by day", String(Math.round(result.daysToDecision.p25))],
        ["50%", String(Math.round(result.daysToDecision.p50))],
        ["75%", String(Math.round(result.daysToDecision.p75))],
        ["90%", String(Math.round(result.daysToDecision.p90))],
      ])
    )
  } else {
    lines.push("No simulated future reached a decision inside the horizon.")
  }
  lines.push("")
  lines.push("Cumulative chance of a decision")
  lines.push(...table(result.cumulative.map((point) => [`by day ${String(point.day).padStart(2)}`, percent(point.p, 0)])))
  lines.push(...diagnosticLines(result))
  return lines.join("\n")
}
