import type { PlanResult } from "../../core/plan.ts"
import { count, keyValueLines, percent, table } from "../format.ts"

export function renderPlan(result: PlanResult): string {
  const { inputs, targetRates } = result
  const e = percent(inputs.minEffect, 0)
  const lines: string[] = []
  lines.push(
    `Sample size plan  baseline ${percent(inputs.baseline)} · detect a ±${e} relative change (to ${percent(targetRates.up)} or ${percent(targetRates.down)}) · ${percent(inputs.power, 0)} power, ${percent(inputs.alpha, 0)} alpha`
  )
  lines.push("")
  const rows: [string, string, string?][] = [
    ["Visitors per variant", count(result.perVariant)],
    ["Total visitors", count(result.total)],
  ]
  if (inputs.dailyVisitors && result.days !== null) {
    rows.push([`Days at ${count(inputs.dailyVisitors)}/day/variant`, String(result.days)])
  }
  lines.push(...keyValueLines(rows, 29))
  lines.push("")
  lines.push("Sensitivity")
  lines.push(
    ...table(
      result.sensitivity.map((row) => {
        const cells = [`min effect`, percent(row.minEffect, row.minEffect * 100 % 1 === 0 ? 0 : 1), `${count(row.perVariant)} per variant`]
        if (row.days !== null) cells.push(`${row.days} days`)
        if (row.minEffect === inputs.minEffect) cells.push("← you are here")
        return cells
      }),
      "  ",
      3
    ).map((line) => line.replace(/(\d+ days) +(← you are here)$/, "$1   $2"))
  )
  if (!inputs.dailyVisitors) {
    lines.push("")
    lines.push("Add --daily-visitors N to convert these to days.")
  }
  return lines.join("\n")
}
