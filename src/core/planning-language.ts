import { containsInternalPlanningText, createPlanningTextFormatter, type PlanningTextContext } from '../shared/planning-language';
import type { ContractCandidate, PlanningReport, PlanningReview, TagPlanning } from '../shared/tags';
import { frozenReportMetadata } from './tags';

function check(texts: string[], context: PlanningTextContext) {
  const index = texts.findIndex(text => containsInternalPlanningText(text, context));
  if (index >= 0) throw new Error(`第${index + 1}段作者可见文字含内部字段或引用编号，请改写为具体中文说明；程序字段和编号仍保留在对应结构化字段中。`);
}
const coverageText = (rows: ContractCandidate['tagCoverage']) => rows.flatMap(row => [row.implementation, row.firstDemonstration, row.risk]);

/** Resolve known machine labels locally, without asking the authoring model to
 * rewrite otherwise valid content. Unknown references still fail the checks. */
export function normalizePlanningLanguage(value: PlanningReport | ContractCandidate | PlanningReview, planning: TagPlanning) {
  const report = 'directions' in value ? value : planning.report;
  const candidate = 'constraints' in value ? value : planning.candidate;
  const format = createPlanningTextFormatter({ report, candidate, knowledge: planning.knowledge });
  let changes = 0;
  const text = (value: string) => { const next = format(value); if (next !== value) changes++; return next; };
  const coverage = (rows: ContractCandidate['tagCoverage']) => rows.forEach(row => {
    row.implementation = text(row.implementation); row.firstDemonstration = text(row.firstDemonstration); row.risk = text(row.risk);
  });
  if ('directions' in value) {
    const frozen = frozenReportMetadata(planning), regeneration = planning.regenerate;
    value.positioning = text(value.positioning);
    value.assumptions.filter(row => !frozen.assumptions.some(old => old.id === row.id && old.text === row.text)).forEach(row => { row.text = text(row.text); });
    value.diagnosis.filter(row => !frozen.diagnosis.some(old => old.code === row.code && old.message === row.message)).forEach(row => { row.message = text(row.message); });
    value.directions.filter(row => !regeneration || (regeneration.keepDirectionIds === undefined ? row.id === regeneration.directionId : !regeneration.keepDirectionIds.includes(row.id))).forEach(row => {
      for (const key of ['title', 'logline', 'storyEngine', 'differenceFromOtherDirections', 'openingDecision', 'firstVolumeChange', 'longRunRisk'] as const) row[key] = text(row[key]);
      row.intentChanges = row.intentChanges.map(text); coverage(row.tagCoverage);
    });
    value.recommendationReasons = value.recommendationReasons.map(text); value.unresolvedQuestions = value.unresolvedQuestions.map(text);
  } else if ('constraints' in value) {
    if (planning.repair) return changes;
    value.constraints.forEach(row => { row.text = text(row.text); }); coverage(value.tagCoverage);
    value.openQuestions = value.openQuestions.map(text);
    value.plan?.statements.forEach(row => { row.text = text(row.text); });
    value.plan?.tagRoles.forEach(row => { row.implementation = text(row.implementation); });
    if (planning.origin === 'new') value.premiseDocument = text(value.premiseDocument);
  } else value.issues.forEach(row => { row.explanation = text(row.explanation); row.suggestedFix = text(row.suggestedFix); });
  return changes;
}

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
