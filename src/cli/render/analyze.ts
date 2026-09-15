import type { AnalyzeResult } from "../../core/analyze.ts"
import { capitalize, count, keyValueLines, missedConversions, percent, points, signedPercent, table, unsignedPoints } from "../format.ts"

function derivedNote(result: AnalyzeResult, derivedFrom: { rateA?: number; rateB?: number } | null): string | null {
  if (!derivedFrom) return null
  const parts: string[] = []
  if (derivedFrom.rateA !== undefined) parts.push(`A = ${result.inputs.conversionsA}/${result.inputs.visitorsA} from --rate-a ${percent(derivedFrom.rateA, 2)}`)
  if (derivedFrom.rateB !== undefined) parts.push(`B = ${result.inputs.conversionsB}/${result.inputs.visitorsB} from --rate-b ${percent(derivedFrom.rateB, 2)}`)
  return parts.join(", ")
}

export function renderAnalyzeBrief(result: AnalyzeResult, derivedFrom: { rateA?: number; rateB?: number } | null): string {
  const minEffect = percent(result.inputs.minEffect, 0)
  const [lower, upper] = result.effect.relativeLiftCI95
  const parts = [
    result.decision.label,
    `P(B beats A) ${percent(result.probability.bBeatsA)}`,
    `P(lift > +${minEffect}) ${percent(result.probability.meaningfulLift)}`,
    `lift ${signedPercent(result.effect.relativeLift)} (CI ${signedPercent(lower)} to ${signedPercent(upper)})`,
    `loss if ship B ${unsignedPoints(result.expectedLoss.shipB)}`,
  ]
  const note = derivedNote(result, derivedFrom)
  return parts.join(" · ") + (note ? `  ${note}` : "")
}

export function renderAnalyze(result: AnalyzeResult, derivedFrom: { rateA?: number; rateB?: number } | null): string {
  const { inputs, decision, probability, effect, expectedLoss, variants, sampleSize, waiting, frequentist } = result
  const minEffect = percent(inputs.minEffect, 0)
  const [liftLower, liftUpper] = effect.relativeLiftCI95
  const [absLower, absUpper] = effect.absoluteDiffCI95
  const lines: string[] = []
  const note = derivedNote(result, derivedFrom)

  lines.push(
    `Bayesian A/B test  Beta(${inputs.prior[0]},${inputs.prior[1]}) prior · decision threshold ${percent(inputs.threshold, 0)} · meaningful effect ±${minEffect} relative`
  )
  if (note) lines.push(`                   ${note}`)
  lines.push("")
  lines.push(
    ...keyValueLines(
      [
        ["Decision", decision.label],
        ["Evidence", capitalize(decision.evidence), `(${percent(decision.maturityProgress, 0)} of the way to a stable estimate)`],
        [
          "Bayes action now",
          `Ship ${decision.bayesActionNow}`,
          `(expected regret ${unsignedPoints(decision.expectedRegretNow)}, about ${missedConversions(decision.expectedRegretNow)})`,
        ],
      ],
      20
    )
  )
  lines.push("")
  lines.push(
    ...table([
      ["", "Variant A", "Variant B"],
      ["Visitors", count(variants.A.visitors), count(variants.B.visitors)],
      ["Conversions", count(variants.A.conversions), count(variants.B.conversions)],
      ["Observed rate", percent(variants.A.rate), percent(variants.B.rate)],
      ["Posterior mean", percent(variants.A.posteriorMean, 3), percent(variants.B.posteriorMean, 3)],
      ["Posterior", `Beta(${count(variants.A.posterior[0])}, ${count(variants.A.posterior[1])})`, `Beta(${count(variants.B.posterior[0])}, ${count(variants.B.posterior[1])})`],
    ])
  )
  lines.push("")
  lines.push(
    ...keyValueLines(
      [
        ["P(B beats A)", percent(probability.bBeatsA)],
        [`P(relative lift > +${minEffect})`, percent(probability.meaningfulLift)],
        [`P(relative lift < -${minEffect})`, percent(probability.meaningfulHarm)],
        ["P(B is harmful at all)", percent(probability.harmful)],
      ],
      36
    )
  )
  lines.push("")
  lines.push(
    ...keyValueLines(
      [
        ["Relative lift", signedPercent(effect.relativeLift), `95% CI  ${signedPercent(liftLower)} to ${signedPercent(liftUpper)}`],
        ["Absolute difference", points(effect.absoluteDiff), `95% CI  ${points(absLower)} to ${points(absUpper)}`],
        ["Observed difference", points(effect.observedAbsoluteDiff), `relative ${signedPercent(effect.observedRelativeLift)}`],
      ],
      23
    )
  )
  lines.push("")
  lines.push(
    ...keyValueLines(
      [
        ["Expected loss if you ship B", unsignedPoints(expectedLoss.shipB)],
        ["Expected loss if you ship A", unsignedPoints(expectedLoss.shipA)],
        ["Two-sided p-value", frequentist.pValueTwoSided.toFixed(3), "frequentist reference only"],
      ],
      36
    )
  )
  lines.push("")
  lines.push("Sample size")
  lines.push(
    ...keyValueLines(
      [
        ["Smallest detectable effect now", `~${percent(sampleSize.detectableEffectNow, 0)} relative`],
        ["Visitors needed per variant", count(sampleSize.requiredPerVariant), `to detect ±${minEffect} at 80% power`],
        ["Additional visitors per variant", count(sampleSize.additionalPerVariant)],
      ],
      36,
      "  "
    )
  )
  lines.push("")
  lines.push("Value of waiting  expected regret after N more visitors per variant")
  lines.push(
    ...table([
      ["ship now", unsignedPoints(decision.expectedRegretNow), ""],
      ...waiting.map((scenario) => [
        `+${count(scenario.extraPerVariant)}`,
        unsignedPoints(scenario.expectedRegret),
        `value of waiting  ${unsignedPoints(scenario.valueOfWaiting)}`,
      ]),
    ])
  )
  lines.push("")
  lines.push(`Share  ${result.shareUrl}`)
  return lines.join("\n")
}
