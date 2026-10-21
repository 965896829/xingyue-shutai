import { containsInternalPlanningText, type PlanningTextContext } from '../shared/planning-language';
import type { ContractCandidate, PlanningReport, PlanningReview, TagPlanning } from '../shared/tags';
import { frozenReportMetadata } from './tags';

function check(texts: string[], context: PlanningTextContext) {
  const index = texts.findIndex(text => containsInternalPlanningText(text, context));
  if (index >= 0) throw new Error(`第${index + 1}段作者可见文字含内部字段或引用编号，请改写为具体中文说明；程序字段和编号仍保留在对应结构化字段中。`);
}
const coverageText = (rows: ContractCandidate['tagCoverage']) => rows.flatMap(row => [row.implementation, row.firstDemonstration, row.risk]);

export function checkPlanningReportLanguage(report: PlanningReport, planning: TagPlanning) {
  const regeneration = planning.regenerate;
  const directions = !regeneration ? report.directions : report.directions.filter(direction =>
    regeneration.keepDirectionIds === undefined
      ? direction.id === regeneration.directionId
      : !regeneration.keepDirectionIds.includes(direction.id));
  const frozen = frozenReportMetadata(planning);
  // validateReport protects these exact historical texts before the language check runs.
  const assumptions = report.assumptions.filter(row => !frozen.assumptions.some(old =>
    old.id === row.id && old.text === row.text));
  const diagnosis = report.diagnosis.filter(row => !frozen.diagnosis.some(old =>
    old.code === row.code && old.message === row.message));
  check([
    report.positioning, ...diagnosis.map(row => row.message), ...assumptions.map(row => row.text),
    ...directions.flatMap(row => [row.title, row.logline, row.storyEngine, row.differenceFromOtherDirections,
      row.openingDecision, row.firstVolumeChange, row.longRunRisk, ...row.intentChanges, ...coverageText(row.tagCoverage)]),
    ...report.recommendationReasons, ...report.unresolvedQuestions
  ], { report, knowledge: planning.knowledge });
}

export function checkPlanningContractLanguage(candidate: ContractCandidate, planning: TagPlanning) {
  check([
    ...candidate.constraints.map(row => row.text), ...coverageText(candidate.tagCoverage), ...candidate.openQuestions,
    ...(candidate.plan?.statements.map(row => row.text) ?? []), ...(candidate.plan?.tagRoles.map(row => row.implementation) ?? []),
    ...(planning.origin === 'new' ? [candidate.premiseDocument] : [])
  ], { report: planning.report, candidate, knowledge: planning.knowledge });
}

export function checkPlanningReviewLanguage(review: PlanningReview, planning: TagPlanning) {
  check(review.issues.flatMap(row => [row.explanation, row.suggestedFix]), {
    report: planning.report, candidate: planning.candidate, knowledge: planning.knowledge
  });
}
