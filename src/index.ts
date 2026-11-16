export { analyze, DECISION_LABELS, DEFAULT_MIN_EFFECT, DEFAULT_SAMPLES, DEFAULT_THRESHOLD, PRIOR_ALPHA, PRIOR_BETA, isDefaultPrior, validatePrior } from "./core/analyze.ts"
export type {
  AnalyzeInputs,
  AnalyzeResult,
  ChartPoint,
  DecisionStatus,
  EvidenceStrength,
  Maturity,
  Variant,
  VariantSummary,
  WaitingScenario,
} from "./core/analyze.ts"
export { project, DEFAULT_HORIZON_DAYS, DEFAULT_MAX_LOSS, DEFAULT_SIMULATIONS } from "./core/project.ts"
export type { ProjectInputs, ProjectResult, ProjectedDecision, StopRule } from "./core/project.ts"
export { plan, requiredSamplePerVariant } from "./core/plan.ts"
export type { PlanInputs, PlanResult, PlanRow } from "./core/plan.ts"
export { shareUrl, WEB_TOOL_URL } from "./core/share.ts"
export { betaPdf, logBeta, logGamma, probabilityBBeatsA, regularizedIncompleteBeta } from "./core/math.ts"
export { liftDensity } from "./core/lift.ts"
export type { LiftDensityPoint } from "./core/lift.ts"
export { integratedExpectedLoss } from "./core/loss.ts"
export {
  analyzeSkeptical,
  calibrateLiftPrior,
  observedLogLift,
  parsePastTestsCsv,
  skepticalShareUrl,
  DEFAULT_LIFT_PRIOR_SD,
  DEFAULT_MAX_RELATIVE_LOSS,
  DEFAULT_SKEPTICAL_MIN_EFFECT,
  MIN_RELIABLE_CONVERSIONS,
  SKEPTICAL_LABELS,
  SKEPTICAL_WEB_TOOL_URL,
} from "./core/skeptical.ts"
export type {
  CalibrationResult,
  PastTest,
  SkepticalChartPoint,
  SkepticalInputs,
  SkepticalResult,
  SkepticalSensitivityRow,
  SkepticalStatus,
  SkepticalWarning,
} from "./core/skeptical.ts"
export { normalCdf, inverseNormalCdf } from "./core/math.ts"
