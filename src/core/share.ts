export const WEB_TOOL_URL = "https://www.joebrundage.com/tools/bayesian-ab-test"

export type ShareInputs = {
  visitorsA: number
  conversionsA: number
  visitorsB: number
  conversionsB: number
  threshold: number
  minEffect: number
}

function formatPercentParam(fraction: number): string {
  return String(Number((fraction * 100).toPrecision(10)))
}

export function shareUrl(inputs: ShareInputs): string {
  const params = new URLSearchParams({
    visitorsA: String(inputs.visitorsA),
    conversionsA: String(inputs.conversionsA),
    visitorsB: String(inputs.visitorsB),
    conversionsB: String(inputs.conversionsB),
    thresholdPercent: formatPercentParam(inputs.threshold),
    meaningfulLiftPercent: formatPercentParam(inputs.minEffect),
  })
  return `${WEB_TOOL_URL}?${params.toString()}`
}
