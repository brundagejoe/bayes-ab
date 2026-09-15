export { analyze, DECISION_LABELS, DEFAULT_MIN_EFFECT, DEFAULT_SAMPLES, DEFAULT_THRESHOLD } from "./core/analyze.ts"
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
export { probabilityBBeatsA } from "./core/math.ts"
