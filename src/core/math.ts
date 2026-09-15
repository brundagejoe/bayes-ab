const LANCZOS_COEFFICIENTS = [
  676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
  12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
]

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

export function logGamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
  }
  const shifted = z - 1
  let x = 0.9999999999998099
  for (let index = 0; index < LANCZOS_COEFFICIENTS.length; index += 1) {
    x += (LANCZOS_COEFFICIENTS[index] as number) / (shifted + index + 1)
  }
  const t = shifted + LANCZOS_COEFFICIENTS.length - 0.5
  return 0.9189385332046727 + (shifted + 0.5) * Math.log(t) - t + Math.log(x)
}

export function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b)
}

export function betaPdf(x: number, alpha: number, beta: number): number {
  const boundedX = clamp(x, 1e-9, 1 - 1e-9)
  return Math.exp(
    (alpha - 1) * Math.log(boundedX) + (beta - 1) * Math.log(1 - boundedX) - logBeta(alpha, beta)
  )
}

export type Random = () => number

export function makeDeterministicRandom(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
}

export function sampleStandardNormal(random: Random): number {
  const u1 = clamp(random(), 1e-12, 1 - 1e-12)
  const u2 = random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

export function sampleGamma(shape: number, random: Random): number {
  if (shape < 1) {
    const u = clamp(random(), 1e-12, 1 - 1e-12)
    return sampleGamma(shape + 1, random) * u ** (1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  while (true) {
    const x = sampleStandardNormal(random)
    const v = (1 + c * x) ** 3
    if (v <= 0) continue
    const u = random()
    if (u < 1 - 0.0331 * x ** 4) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

export function sampleBeta(alpha: number, beta: number, random: Random): number {
  const x = sampleGamma(alpha, random)
  const y = sampleGamma(beta, random)
  return x / (x + y)
}

export function sampleBinomialApprox(trials: number, probability: number, random: Random): number {
  const boundedTrials = Math.max(0, Math.round(trials))
  const boundedProbability = clamp(probability, 0, 1)
  if (boundedTrials === 0 || boundedProbability === 0) return 0
  if (boundedProbability === 1) return boundedTrials
  if (boundedTrials <= 50) {
    let successes = 0
    for (let index = 0; index < boundedTrials; index += 1) {
      if (random() < boundedProbability) successes += 1
    }
    return successes
  }
  const mean = boundedTrials * boundedProbability
  const standardDeviation = Math.sqrt(boundedTrials * boundedProbability * (1 - boundedProbability))
  return clamp(Math.round(mean + sampleStandardNormal(random) * standardDeviation), 0, boundedTrials)
}

export function quantile(sortedValues: number[], probability: number): number {
  const boundedProbability = clamp(probability, 0, 1)
  const position = (sortedValues.length - 1) * boundedProbability
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sortedValues[lowerIndex] as number
  if (lowerIndex === upperIndex) return lower
  const upper = sortedValues[upperIndex] as number
  const weight = position - lowerIndex
  return lower * (1 - weight) + upper * weight
}

export function mean(values: number[]): number {
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

function probabilityRightBeatsLeftDirect(
  alphaLeft: number,
  betaLeft: number,
  alphaRight: number,
  betaRight: number
): number {
  const base = logBeta(alphaLeft, betaLeft)
  let maxLog = Number.NEGATIVE_INFINITY
  let scaledSum = 0
  for (let i = 0; i <= alphaRight - 1; i += 1) {
    const current =
      logBeta(alphaLeft + i, betaLeft + betaRight) - Math.log(betaRight + i) - logBeta(1 + i, betaRight) - base
    if (current <= maxLog) {
      scaledSum += Math.exp(current - maxLog)
      continue
    }
    scaledSum = scaledSum * Math.exp(maxLog - current) + 1
    maxLog = current
  }
  return Math.exp(maxLog) * scaledSum
}

/** Exact P(B > A) for independent Beta posteriors, via Evan Miller's closed form. */
export function probabilityBBeatsA(alphaA: number, betaA: number, alphaB: number, betaB: number): number {
  if (alphaB <= alphaA) {
    return probabilityRightBeatsLeftDirect(alphaA, betaA, alphaB, betaB)
  }
  return 1 - probabilityRightBeatsLeftDirect(alphaB, betaB, alphaA, betaA)
}

export function inverseNormalCdf(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const probability = clamp(p, 1e-9, 1 - 1e-9)
  const pLow = 0.02425
  const pHigh = 1 - pLow
  const tail = (q: number) =>
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  if (probability < pLow) return tail(Math.sqrt(-2 * Math.log(probability)))
  if (probability > pHigh) return -tail(Math.sqrt(-2 * Math.log(1 - probability)))
  const q = probability - 0.5
  const r = q * q
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  )
}

export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const absoluteX = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * absoluteX)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-absoluteX * absoluteX)
  return sign * y
}

export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2))
}

export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/** Rounds to a fixed number of decimals for compact, stable JSON. */
export function round(value: number, decimals = 6): number {
  if (!Number.isFinite(value)) return value
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
