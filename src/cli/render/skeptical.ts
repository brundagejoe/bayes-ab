import type { CalibrationResult, SkepticalResult, SkepticalWarning } from "../../core/skeptical.ts"
import { SKEPTICAL_LABELS } from "../../core/skeptical.ts"
import { count, keyValueLines, missedConversions, percent, points, signedPercent, table, unsignedPoints } from "../format.ts"

function derivedNote(result: SkepticalResult, derivedFrom: { rateA?: number; rateB?: number } | null): string | null {
  if (!derivedFrom) return null
  const parts: string[] = []
  if (derivedFrom.rateA !== undefined) parts.push(`A = ${result.inputs.conversionsA}/${result.inputs.visitorsA} from --rate-a ${percent(derivedFrom.rateA, 2)}`)
  if (derivedFrom.rateB !== undefined) parts.push(`B = ${result.inputs.conversionsB}/${result.inputs.visitorsB} from --rate-b ${percent(derivedFrom.rateB, 2)}`)
  return parts.join(", ")
}

const WARNING_TEXT: Record<SkepticalWarning, string> = {
  few_conversions: "Fewer than 30 conversions in a variant: the normal approximation is rough here.",
  zero_or_all_conversions: "A variant has 0 conversions (or all visitors converted); half a conversion was added to keep the math finite.",
  decision_sensitive_to_prior: "The decision changes with the prior spread (see Sensitivity). The data has not settled it yet.",
}

const yesNo = (value: boolean) => (value ? "yes" : "no")

export function renderSkepticalBrief(result: SkepticalResult, derivedFrom: { rateA?: number; rateB?: number } | null): string {
  const [lower, upper] = result.effect.relativeLiftCI95
  const parts = [
    result.decision.label,
    `P(B beats A) ${percent(result.probability.bBeatsA)}`,
    `lift ${signedPercent(result.effect.relativeLift)} (CI ${signedPercent(lower)} to ${signedPercent(upper)}; observed ${signedPercent(result.effect.observedRelativeLift)})`,
    `loss if ship B ${percent(result.expectedLoss.shipBRelative, 3)} relative`,
    `lift prior ±${percent(result.inputs.liftPriorSd, 1)}`,
  ]
  if (!result.sensitivity.robust) parts.push("sensitive to prior")
  const note = derivedNote(result, derivedFrom)
  return parts.join(" · ") + (note ? `  ${note}` : "")
}

export function renderSkeptical(result: SkepticalResult, derivedFrom: { rateA?: number; rateB?: number } | null): string {
  const { inputs, decision, logLift, weights, probability, effect, expectedLoss, variants, sampleSize, sensitivity, warnings } = result
  const minEffect = percent(inputs.minEffect, 0)
  const [liftLower, liftUpper] = effect.relativeLiftCI95
  const [absLower, absUpper] = effect.absoluteDiffCI95
  const lines: string[] = []
  const note = derivedNote(result, derivedFrom)

  lines.push(
    `Skeptical A/B test  lift prior Normal(0, ${percent(inputs.liftPriorSd, 1)}) · threshold ${percent(inputs.threshold, 0)} · max loss ${percent(inputs.maxRelativeLoss, 2)} relative · no-effect band ±${minEffect}`
  )
  if (note) lines.push(`                    ${note}`)
  lines.push("")
  lines.push(...keyValueLines([["Decision", decision.label]], 20))
  lines.push(
    ...keyValueLines(
      [
        [`P(B beats A) ≥ ${percent(inputs.threshold, 0)}`, yesNo(decision.checks.bBeatsAReached)],
        [`Loss if ship B ≤ ${percent(inputs.maxRelativeLoss, 2)}`, yesNo(decision.checks.shipBLossAcceptable)],
        [`P(A beats B) ≥ ${percent(inputs.threshold, 0)}`, yesNo(decision.checks.aBeatsBReached)],
        [`Loss if keep A ≤ ${percent(inputs.maxRelativeLoss, 2)}`, yesNo(decision.checks.keepALossAcceptable)],
        [`95% CI inside ±${minEffect}`, yesNo(decision.checks.withinNoEffectBand)],
      ],
      34,
      "  "
    )
  )
  lines.push("")
  lines.push(
    ...table([
      ["", "Variant A", "Variant B"],
      ["Visitors", count(variants.A.visitors), count(variants.B.visitors)],
      ["Conversions", count(variants.A.conversions), count(variants.B.conversions)],
      ["Observed rate", percent(variants.A.rate), percent(variants.B.rate)],
    ])
  )
  lines.push("")
  lines.push("How the prior pulled the estimate")
  lines.push(
    ...keyValueLines(
      [
        ["Observed lift", signedPercent(effect.observedRelativeLift), `± ${percent(logLift.noise, 1)} noise`],
        ["Estimated lift", signedPercent(effect.relativeLift), `95% CI  ${signedPercent(liftLower)} to ${signedPercent(liftUpper)}`],
        ["Weight on the data", percent(weights.dataShare, 0), `the rest pulls toward 0`],
        ["Prior is worth", `${count(weights.priorEquivalentConversionsPerVariant)} conversions`, `about ${count(weights.priorEquivalentVisitorsPerVariant)} visitors per variant`],
        ["Absolute difference", points(effect.absoluteDiff, 3), `95% CI  ${points(absLower, 3)} to ${points(absUpper, 3)}`],
      ],
      24,
      "  "
    )
  )
  lines.push("")
  lines.push(
    ...keyValueLines(
      [
        ["P(B beats A)", percent(probability.bBeatsA)],
        [`P(relative lift > +${minEffect})`, percent(probability.meaningfulLift)],
        [`P(relative lift < -${minEffect})`, percent(probability.meaningfulHarm)],
        ["Expected loss if you ship B", `${percent(expectedLoss.shipBRelative, 3)} relative`, `${unsignedPoints(expectedLoss.shipB)}, about ${missedConversions(expectedLoss.shipB)}`],
        ["Expected loss if you keep A", `${percent(expectedLoss.shipARelative, 3)} relative`, `${unsignedPoints(expectedLoss.shipA)}`],
      ],
      34
    )
  )
  lines.push("")
  lines.push("Sensitivity  same data, different lift priors")
  lines.push(
    ...table([
      ["Prior spread", "Estimated lift", "P(B beats A)", "Decision"],
      ...sensitivity.rows.map((row) => [`±${percent(row.liftPriorSd, 1)}`, signedPercent(row.relativeLift), percent(row.bBeatsA), SKEPTICAL_LABELS[row.status]]),
    ])
  )
  lines.push("")
  lines.push("Sample size")
  lines.push(
    ...keyValueLines(
      [
        ["Visitors needed per variant", count(sampleSize.requiredPerVariant), `to detect ±${minEffect} at 80% power (${percent(sampleSize.progress, 0)} there)`],
        ["Additional visitors per variant", count(sampleSize.additionalPerVariant)],
      ],
      34,
      "  "
    )
  )
  if (warnings.length > 0) {
    lines.push("")
    for (const warning of warnings) lines.push(`note  ${WARNING_TEXT[warning]}`)
  }
  lines.push("")
  lines.push(`Share  ${result.shareUrl}`)
  return lines.join("\n")
}

const CALIBRATION_WARNING_TEXT: Record<CalibrationResult["warnings"][number], string> = {
  few_tests: "Fewer than 10 tests: treat the spread as a rough guess.",
  no_spread_beyond_noise: "Past lifts vary no more than noise alone would explain, so the spread was raised to the 0.5% floor.",
  average_not_zero: "Past tests lean clearly one way on average; the skeptical prior is still centered on zero.",
}

export function renderCalibrate(result: CalibrationResult): string {
  const lines: string[] = []
  lines.push(`Lift prior calibration  ${result.tests} past tests · DerSimonian-Laird`)
  lines.push("")
  lines.push(
    ...keyValueLines(
      [
        ["Suggested --lift-prior-sd", percent(result.liftPriorSd, 1), result.floored ? "(floored)" : ""],
        ["Spread of observed lifts", percent(result.observedSd, 1), "real differences plus noise"],
        ["Typical noise per test", percent(result.typicalNoise, 1)],
        ["Average lift", signedPercent(Math.exp(result.averageLogLift) - 1)],
      ],
      28
    )
  )
  lines.push("")
  lines.push(
    ...table([
      ["Test", "Observed lift", "Noise"],
      ...result.perTest.map((test, index) => [String(index + 1), signedPercent(test.relativeLift), `±${percent(test.noise, 1)}`]),
    ])
  )
  if (result.warnings.length > 0) {
    lines.push("")
    for (const warning of result.warnings) lines.push(`note  ${CALIBRATION_WARNING_TEXT[warning]}`)
  }
  return lines.join("\n")
}
