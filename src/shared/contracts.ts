import { z } from 'zod';
import { labSessionSchema, labDetailSchema, labCreateSchema, labUpdateSchema, labEditSchema, labSelectSchema, labGenerateSchema, labContextSchema, labRequestSchema, labExportSchema } from './story-lab';
import { skillExecutionSchema } from './skill-contract';
import { writingStyleRequestSchema, writingStyleReportSchema } from './writing-style';
import { bookProfileSchema, bookProfileStateSchema, publishingSnapshotSchema } from './publishing';
import { marketEvidenceSchema, marketRequestSchema } from './market-evidence';
import { managementStatusSchema } from './management';
import { configSchema, profileSchema, protocolSchema, stageIds } from './types';
import { searchSettingsSchema } from './assistant';
import { embeddingSettingsSchema, memoryScopeSchema } from './studio';
import { tagInputSchema } from './tags';
import { titleStyleProfileSchema } from './title-style';
import * as schemas from './contract-schemas';
import { errorCodes } from './errors';
import { reasoningEffortSchema } from './reasoning';
import { narrativeDataSchema } from './narrative-curve';
import { manuscriptViewSchema } from './manuscript-view';
import { creativeInputSchema } from './creative';
import { qualityStateSchema, qualityMutationSchema, qualityStatsSchema, worldModelSchema } from './quality';
import { designInputSchema, designEntrySchema } from './design';
import { experienceSchema, maxExperienceChapter } from './experience';
import { reviewFeedbackSchema } from './blind-review';
import { workbenchBindingSchema, workbenchViewSchema } from './workbench';
import { candidateViewSchema, plotMutationSchema, plotViewSchema, reorderDecisionSchema, reorderPreviewSchema, stateHistorySchema, workbenchMediaSchema, workbenchScopeBindingSchema } from './workbench-visual';

const text = z.string();
const key = text.min(1);
const optionalText = text.optional();
const flag = z.boolean().optional();
const integer = z.number().int().nonnegative();
const empty = z.strictObject({});
const identity = z.strictObject({ id: key });
const entity = z.object({ id: text, name: text, aliases: z.array(text) });
const ok = z.boolean();
const document = z.strictObject({ path: text, content: text, hash: text });
const settings = z.object({ roles: z.array(schemas.roleRuleSchema), search: searchSettingsSchema, hasKey: ok, embedding: embeddingSettingsSchema });
const action = z.strictObject({ kind: z.enum(['stage', 'revision', 'draft']), goal: key.max(500), scope: key.max(3000), request: key.max(20000), outputs: z.array(key.max(300)).min(1).max(20) });
const connection = z.strictObject({ id: optionalText, name: optionalText, protocol: protocolSchema, baseUrl: text.url(), proxy: optionalText, headers: z.record(text, text).optional() });
const model = z.object(profileSchema.shape).omit({ id: true, name: true, protocol: true, baseUrl: true });
const draftRead = z.intersection(schemas.draftArtifactSchema, z.object({ content: text, currentHash: text }));
const chatData = z.object({ conversation: schemas.conversationSchema, messages: z.array(schemas.conversationMessageSchema), turns: z.array(schemas.conversationTurnSchema), proposals: z.array(schemas.actionProposalSchema) });
const retrieval = z.object({
  disputes: z.array(schemas.factSchema).optional(),
  facts: z.array(z.object({ fact: schemas.factSchema, reason: text, score: z.number().optional(), required: flag })),
  documents: z.array(z.object({ path: text, hash: text, excerpt: text, reason: text })),
  issues: z.array(text), status: text,
  snapshotId: optionalText, scope: memoryScopeSchema.optional(), total: integer.optional(), offset: integer.optional(), hasMore: flag,
  coverage: z.array(z.object({ ledger: text, status: text, count: integer })).optional(),
  semantic: optionalText, note: optionalText, indexRevision: integer.optional()
});
const legacyPreview = z.object({ files: z.array(z.object({ path: text, bytes: integer, warning: optionalText })), suggestedChapter: integer, warnings: z.array(text) });
const trashRecord = z.object({ id: text, projectId: text, title: text, originalRoot: text, deletedAt: integer, expiresAt: integer, state: z.enum(['moving', 'ready', 'restoring', 'restored', 'purging', 'purged']), restoreRoot: optionalText, error: optionalText }).passthrough();
const coverMetadata = z.object({ book: optionalText, title: optionalText, author: optionalText, subtitle: optionalText, background: optionalText, prompt: optionalText, font: optionalText, color: optionalText, size: z.number().optional(), x: z.number().optional(), authorX: z.number().optional(), y: z.number().optional(), authorY: z.number().optional(), picture: optionalText }).catchall(z.json());

export type Access = 'read' | 'write' | 'remote' | 'lifecycle' | 'system';
function define<I extends z.ZodType, O extends z.ZodType>(input: I, output: O, access: Access = 'read', scope: 'project' | 'global' = 'project') {
  return { input, output, access, scope, timeout: access === 'remote' ? 1_830_000 : access === 'lifecycle' ? 120_000 : access === 'write' ? 120_000 : 30_000,
    idempotent: access === 'read', errors: errorCodes };
}

export const commandContracts = {
  'lab.list': define(empty, z.array(labSessionSchema), 'read', 'global'),
  'lab.read': define(z.strictObject({ sessionId: z.string().uuid() }), labDetailSchema, 'read', 'global'),
  'lab.create': define(labCreateSchema, labDetailSchema, 'write', 'global'),
  'lab.update': define(labUpdateSchema, labDetailSchema, 'write', 'global'),
  'lab.edit': define(labEditSchema, labDetailSchema, 'write', 'global'),
  'lab.select': define(labSelectSchema, labDetailSchema, 'write', 'global'),
  'lab.preview': define(labGenerateSchema, labContextSchema, 'read', 'global'),
  'lab.generate': define(labGenerateSchema, labRequestSchema, 'write', 'global'),
  'lab.cancel': define(z.strictObject({ sessionId: z.string().uuid(), requestId: z.string().uuid() }), ok, 'write', 'global'),
  'lab.export': define(labExportSchema, z.strictObject({ filename: text, content: text, path: text }), 'write', 'global'),
  'style.recommend': define(writingStyleRequestSchema, writingStyleReportSchema, 'remote', 'global'),
  'style.cancel': define(z.strictObject({ requestId: z.string().uuid() }), ok, 'write', 'global'),
  'publishing.refresh': define(empty, z.object({ updated: ok, catalog: publishingSnapshotSchema, message: text }), 'remote', 'global'),
  'publishing.market': define(marketRequestSchema, marketEvidenceSchema, 'remote', 'global'),
  'publishing.read': define(empty, bookProfileStateSchema),
  'publishing.propose': define(z.strictObject({ profile: bookProfileSchema, baseHash: text.nullable(), snapshotId: key }), key, 'write'),
  'run.reviewProse': define(z.strictObject({ id: key, proposalHash: key, profileId: key }), key, 'write'),
  'quality.read': define(empty, qualityStateSchema),
  'workbench.read': define(z.strictObject({ scope: memoryScopeSchema }), workbenchViewSchema),
  'workbench.field': define(z.strictObject({ binding: workbenchBindingSchema, fieldId: key, value: text.max(4000) }), key, 'write'),
  'workbench.lock': define(z.strictObject({ binding: workbenchBindingSchema, fieldId: key, locked: ok }), ok, 'write'),
  'workbench.discuss': define(z.strictObject({ binding: workbenchBindingSchema }), schemas.conversationSchema, 'write'),
  'workbench.plot': define(z.strictObject({ scope: memoryScopeSchema, chapter: integer.min(1) }), plotViewSchema),
  'workbench.plotPropose': define(z.strictObject({ binding: workbenchScopeBindingSchema, baseHash: text.nullable(), mutation: plotMutationSchema }), key, 'write'),
  'workbench.reorderPreview': define(z.strictObject({ binding: workbenchScopeBindingSchema, order: z.array(integer.min(1)).min(2).max(5000) }), reorderPreviewSchema),
  'workbench.reorderPropose': define(z.strictObject({ binding: workbenchScopeBindingSchema, order: z.array(integer.min(1)).min(2).max(5000), fingerprint: key, decisions: z.array(reorderDecisionSchema) }), key, 'write'),
  'workbench.history': define(z.strictObject({ binding: workbenchBindingSchema, compareSnapshotId: optionalText }), stateHistorySchema),
  'workbench.avatar': define(z.strictObject({ binding: workbenchBindingSchema }), z.strictObject({ metadata: workbenchMediaSchema, dataUrl: text }).nullable()),
  'workbench.avatarPropose': define(z.strictObject({ binding: workbenchBindingSchema, dataUrl: text.max(4_300_000).nullable(), name: key.max(200), revealedAt: integer.nullable() }), key, 'write'),
  'workbench.candidates': define(z.strictObject({ binding: workbenchScopeBindingSchema, objectId: optionalText }), z.array(candidateViewSchema)),
  'workbench.accept': define(z.strictObject({ id: key, fingerprint: key, groups: z.array(key).min(1) }), ok, 'write'),
  'workbench.branch': define(z.strictObject({ id: key, fingerprint: key, title: key.max(80) }), schemas.draftArtifactSchema, 'write'),
  'workbench.worldImpact': define(z.strictObject({ binding: workbenchScopeBindingSchema, moduleId: key }), z.array(z.strictObject({ path: key, reason: text }))),
  'quality.exportReview': define(z.strictObject({ experimentIds: z.array(key).min(1).max(100) }), z.strictObject({ packetId: key, html: text }), 'write'),
  'quality.importReview': define(z.strictObject({ expectedRevision: integer, feedback: reviewFeedbackSchema }), z.strictObject({ state: qualityStateSchema, imported: integer, duplicate: ok }), 'write'),
  'design.list': define(empty, z.array(designEntrySchema)),
  'experience.read': define(z.object({ throughChapter: integer.min(1).max(maxExperienceChapter), fromChapter: integer.min(1).max(maxExperienceChapter).optional(), before: integer.min(1).optional(), watermark: integer.min(0).optional(), pageSize: integer.min(1).max(100).optional() }).strict(), experienceSchema),
  'design.run': define(z.object({ input: designInputSchema, profileId: optionalText }).strict(), key, 'write'),
  'quality.mutate': define(z.strictObject({ expectedRevision: integer, mutation: qualityMutationSchema }), qualityStateSchema, 'write'),
  'quality.statistics': define(z.strictObject({ experimentId: key }), qualityStatsSchema),
  'quality.presentation': define(identity, z.object({ id: key, questions: z.array(text), candidates: z.array(z.object({ alias: key, text, hash: key })) })),
  'quality.voice': define(z.strictObject({ ids: z.array(key).min(1).max(50) }), key, 'write'),
  'world.read': define(empty, z.object({ model: worldModelSchema, baseHash: text.nullable() })),
  'world.propose': define(z.strictObject({ model: worldModelSchema, baseHash: text.nullable() }), key, 'write'),
  'management.status': define(empty, managementStatusSchema, 'read', 'global'),
  'management.open': define(empty, ok, 'system', 'global'),
  'management.link': define(empty, text.url(), 'system', 'global'),
  'management.revoke': define(empty, ok, 'system', 'global'),
  'management.stop': define(empty, ok, 'system', 'global'),
  'history.preview': define(empty, z.object({ dryRun: z.literal(true), deletionEnabled: z.literal(false), objects: integer, bytes: integer, retained: integer, preservedFiles: integer, candidates: z.array(z.object({ version: text, bytes: integer, retained: ok })) })),
  'operation.query': define(identity, z.object({ id: text, kind: text, inputHash: text, status: z.enum(['started', 'complete', 'unknown']), result: z.unknown().optional(), createdAt: text }).nullable()),
  'app.snapshot': define(empty, schemas.snapshotSchema, 'read', 'global'),
  'resource.read': define(z.strictObject({ resources: z.array(z.enum(['runs', 'chat', 'documents', 'studio'])).min(1).max(4) }), z.object({
    projectSessionId: text, eventSeq: integer, runs: z.array(schemas.runSchema).optional(), events: z.array(schemas.runEventSchema).optional(),
    conversations: z.array(schemas.conversationSchema).optional(), chatBusy: ok.optional(), documents: z.array(schemas.documentInfoSchema).optional(), studio: schemas.studioStateSchema.optional()
  })),
  'app.chooseDirectory': { ...define(z.strictObject({ title: optionalText }), text.nullable(), 'system', 'global'), timeout: 1_830_000 },
  'app.chooseFile': { ...define(z.strictObject({ save: flag, name: optionalText }), text.nullable(), 'system', 'global'), timeout: 1_830_000 },
  'app.reveal': define(empty, ok, 'system'),
  'app.openUrl': define(z.strictObject({ url: text.url() }), ok, 'system', 'global'),
  'project.create': define(z.strictObject({ parent: key, title: text.max(80).optional(), premise: text, tagInput: tagInputSchema.optional(), creationInput: tagInputSchema.optional(), bookProfile: bookProfileSchema.optional(), config: configSchema.optional() }), schemas.snapshotSchema, 'lifecycle', 'global'),
  'project.open': define(z.strictObject({ root: key }), schemas.snapshotSchema, 'lifecycle', 'global'),
  'project.close': define(empty, schemas.snapshotSchema, 'lifecycle', 'global'),
  'project.preview': define(z.strictObject({ title: optionalText, premise: optionalText, config: configSchema.optional() }), z.array(text), 'read', 'global'),
  'project.repair': define(z.strictObject({ preview: flag, indexOnly: flag }), z.union([text, z.array(text)]), 'write'),
  'project.importLegacy': define(z.union([
    z.strictObject({ preview: z.literal(true), source: key }),
    z.strictObject({ preview: z.literal(false).optional(), source: key, parent: key, title: key, chapter: integer.min(1), stage: z.enum(stageIds), config: configSchema })
  ]), z.union([schemas.snapshotSchema, legacyPreview]), 'lifecycle', 'global'),
  'project.trash': define(z.strictObject({ root: key }), schemas.snapshotSchema, 'lifecycle', 'global'),
  'project.listTrash': define(empty, z.array(trashRecord), 'read', 'global'),
  'project.restoreTrash': define(z.strictObject({ id: key, parent: optionalText }), schemas.snapshotSchema, 'lifecycle', 'global'),
  'project.configure': define(z.strictObject({ config: configSchema }), schemas.snapshotSchema, 'write'),
  'project.scan': define(empty, schemas.snapshotSchema),
  'project.importAccept': define(z.strictObject({ path: key }), text, 'write'),
  'project.backup': define(z.strictObject({ directory: optionalText }), text, 'write'),
  'project.restoreBackup': define(z.strictObject({ source: key, parent: key }), text, 'lifecycle', 'global'),
  'project.export': define(z.strictObject({ paths: z.array(key).min(1), target: key }), text, 'write'),
  'project.importDocument': define(z.strictObject({ file: key }), z.object({ name: text, content: text, warnings: z.array(text), hash: text.regex(/^[a-f0-9]{64}$/) }), 'read', 'global'),
  'document.read': define(z.strictObject({ path: key, hash: optionalText, disk: flag }), document),
  'narrative.read': define(z.strictObject({ chapter: integer.min(1).max(100000), runId: optionalText, scope: z.enum(['batch', 'book']).optional() }), narrativeDataSchema),
  'manuscript.read': define(z.strictObject({ runId: optionalText, includeDraft: z.boolean().optional() }), manuscriptViewSchema),
  'document.save': define(z.strictObject({ path: key, content: text, baseHash: text.nullable() }), text, 'write'),
  'document.restore': define(z.strictObject({ path: key, hash: key, baseHash: text.nullable() }), text, 'write'),
  'document.history': define(z.strictObject({ path: key }), z.array(z.object({ hash: text, createdAt: text, tx: text }))),
  'document.historyPage': define(z.strictObject({ path: key, before: integer.optional(), watermark: integer.optional(), limit: integer.min(1).max(200).optional() }), z.object({ items: z.array(z.object({ hash: text, createdAt: text, tx: text })), watermark: integer, nextBefore: integer.nullable() })),
  'run.start': define(z.strictObject({ mode: z.enum(['stage', 'revision']).optional(), request: key, profileId: optionalText }), text, 'write'),
  'run.resume': define(z.strictObject({ id: key, retryUnknown: flag, instruction: optionalText }), text, 'write'),
  'run.recover': define(z.strictObject({ id: key, profileId: optionalText, retryUnknown: flag, instruction: optionalText }), text, 'write'),
  'run.answer': define(z.strictObject({ id: key, answer: key, retryUnknown: flag }), text, 'write'),
  'run.permission': define(z.strictObject({ id: key, approved: ok, retryUnknown: flag }), text, 'write'),
  'run.handoff': define(z.strictObject({ id: key, profileId: key, retryUnknown: flag, instruction: optionalText }), text, 'write'),
  'run.cancel': define(z.strictObject({ id: optionalText }), ok, 'write'),
  'terminal.cancel': define(empty, ok, 'write'),
  'run.accept': define(z.strictObject({ id: key, proposalHash: optionalText, warningReason: optionalText, startNext: flag, title: key.max(80).optional() }), z.object({ accepted: flag, alreadyAccepted: flag, nextRun: optionalText, nextError: optionalText, titleChanged: flag }), 'write'),
  'run.discard': define(identity, ok, 'write'),
  'run.update': define(z.strictObject({ id: key, path: key, content: text }), schemas.runSchema, 'write'),
  'run.revalidate': define(z.strictObject({ id: key, reviewSaved: flag }), schemas.runSchema, 'write'),
  'run.events': define(z.strictObject({ id: key, afterSeq: integer.optional(), limit: integer.min(1).max(500).optional() }), z.array(schemas.runEventSchema)),
  'run.page': define(z.strictObject({ before: integer.optional(), watermark: integer.optional(), limit: integer.min(1).max(200).optional() }), z.object({ items: z.array(schemas.runSchema), watermark: integer, nextBefore: integer.nullable() })),
  'context.preview': define(z.strictObject({ profileId: optionalText, request: optionalText }), schemas.contextManifestSchema),
  'diagnostics.export': define(empty, text),
  'impact.review': define(z.strictObject({ path: key, reason: key }), ok, 'write'),
  'tags.catalog': define(empty, schemas.tagCatalogSchema, 'read', 'global'),
  'tags.validate': define(z.strictObject({ input: tagInputSchema }), schemas.tagKnowledgeSchema, 'read', 'global'),
  'tags.saveDraft': define(z.strictObject({ input: tagInputSchema, expectedRevision: integer }), schemas.bookSpecSchema, 'write'),
  'tags.start': define(z.strictObject({ inputHash: key, requestId: key.max(100), profileId: optionalText, request: optionalText }), text, 'write'),
  'tags.selectDirection': define(z.strictObject({ id: key, reportHash: key, directionId: key, resolutions: z.record(text, key.max(4000)).optional(), acceptAssumptions: z.literal(true).optional() }), text, 'write'),
  'tags.reviseDirection': define(z.strictObject({ id: key, reportHash: key, directionId: key, instruction: key.max(6000) }), text, 'write'),
  'tags.reroll': define(z.strictObject({ id: key, reportHash: key, keepDirectionIds: z.array(key).max(1), instruction: text.max(6000).optional() }), text, 'write'),
  'tags.diff': define(identity, z.object({ before: schemas.approvedTagsSchema.nullable(), after: schemas.contractCandidateSchema.nullable(), affected: z.array(z.object({ path: text }).passthrough()) }).passthrough()),
  'tags.restoreProjection': define(z.strictObject({ baseHash: text.nullable() }), ok, 'write'),
  'creation.saveDraft': define(z.strictObject({ input: tagInputSchema, expectedRevision: integer }), schemas.bookSpecSchema, 'write'),
  'creation.start': define(z.strictObject({ inputHash: key, requestId: key.max(100), profileId: optionalText, request: optionalText }), text, 'write'),
  'creation.confirmPlan': define(z.strictObject({ id: key, proposalHash: key, warningReason: optionalText }), ok, 'write'),
  'creation.revisePlan': define(z.strictObject({ id: key, proposalHash: key, instruction: key.max(6000) }), text, 'write'),
  'titles.styleProfile': define(empty, titleStyleProfileSchema, 'read', 'global'),
  'titles.start': define(z.strictObject({ sourceRunId: optionalText, planHash: key, requestId: key.max(100), profileId: optionalText,
    rule: z.enum(['local', 'fanqie_experiment']).optional(), manualTitle: text.trim().min(1).max(80).optional(), instruction: text.max(6000).optional() }), text, 'write'),
  'titles.regenerate': define(z.strictObject({ id: key, batchHash: key, candidateId: key, instruction: key.max(6000) }), text, 'write'),
  'titles.select': define(z.strictObject({ id: key, batchHash: key, candidateId: key }), z.object({ selected: ok, parentRunId: optionalText }), 'write'),
  'titles.restoreProjection': define(z.strictObject({ baseHash: text.nullable() }), ok, 'write'),
  'studio.read': define(empty, z.intersection(schemas.studioStateSchema, z.object({ entities: z.array(entity) }))),
  'snapshot.list': define(empty, z.array(schemas.snapshotRefSchema)),
  'snapshot.page': define(z.strictObject({ before: integer.optional(), watermark: integer.optional(), limit: integer.min(1).max(200).optional() }), z.object({ items: z.array(schemas.snapshotRefSchema), watermark: integer, nextBefore: integer.nullable() })),
  'outbox.retry': define(empty, schemas.studioStateSchema, 'write'),
  'recovery.preview': define(z.strictObject({ transactionId: key, path: key }), z.strictObject({ path: text, accepted: text, current: text.nullable(), candidate: text })),
  'recovery.retry': define(z.strictObject({ transactionId: key }), schemas.studioStateSchema, 'write'),
  'recovery.abandon': define(z.strictObject({ transactionId: key }), schemas.studioStateSchema, 'write'),
  'memory.list': define(z.strictObject({ category: z.enum(['all', 'character', 'injury', 'item', 'hook', 'knowledge', 'obligations']).optional(), offset: integer.optional(), pageSize: integer.min(1).max(100).optional(), scope: memoryScopeSchema.optional() }), retrieval),
  'memory.retrieve': define(z.strictObject({ query: optionalText, scope: memoryScopeSchema.optional() }), retrieval, 'remote'),
  'memory.search': define(z.strictObject({ query: optionalText, chapter: integer.optional() }), retrieval),
  'memory.rebuild': define(z.strictObject({ profileId: optionalText }), z.object({ count: integer, issues: z.array(text), runId: optionalText }), 'write'),
  'memory.trace': define(z.strictObject({ path: key, hash: key, quote: text, start: integer.optional(), end: integer.optional(), snapshotId: optionalText }), z.intersection(schemas.sourceRefSchema, z.object({ content: text }))),
  'state.getCharacter': define(z.strictObject({ entityId: key, scope: memoryScopeSchema.optional() }), schemas.entityStateSchema),
  'state.proposeCorrection': define(z.strictObject({ kind: z.enum(['extraction', 'plan', 'story', 'assessment']), factId: optionalText, fromChapter: integer.min(1).optional(), request: key }), text, 'write'),
  'embedding.settings.save': define(z.strictObject({ settings: embeddingSettingsSchema, apiKey: optionalText, clearKey: flag }), settings, 'write', 'global'),
  'embedding.test': define(empty, z.object({ ok, dimensions: integer, tokens: z.number().nullable() }), 'remote', 'global'),
  'embedding.reindex': define(empty, ok, 'write'),
  'embedding.cancel': define(empty, ok, 'write'),
  'assessment.refresh': define(z.strictObject({ id: key, content: optionalText, track: z.enum(['plan', 'candidate']).optional() }), schemas.assessmentSchema.nullable(), 'remote'),
  'draft.checkpoint': define(z.strictObject({ id: key, content: optionalText }), ok, 'write'),
  'skills.list': define(empty, z.array(z.object({ id: text, title: text, host: ok, description: text, stage: text, optional: ok, path: text, contract: text, sha256: text, tools: z.array(text), execution: skillExecutionSchema })), 'read', 'global'),
  'expression.catalog': define(empty, schemas.expressionCatalogSchema, 'read', 'global'),
  'creative.run': define(z.strictObject({ input: creativeInputSchema, profileId: optionalText }), text, 'write'),
  'creative.characters': define(z.strictObject({ chapter: integer.min(1) }), z.array(z.object({ id: key, name: key }))),
  'skill.run': define(z.strictObject({ skillId: key, request: optionalText, profileId: optionalText, feedback: z.strictObject({ source: key, window: key, sampleSize: integer, synthetic: ok }).optional() }), z.union([text, z.array(text),
    schemas.contextManifestSchema, z.object({ documents: z.array(schemas.documentInfoSchema), issues: z.array(text) }), retrieval.extend({ entities: z.array(entity) }),
    z.object({ batch: z.object({ start: integer, end: integer }), chapter: integer, complete: ok })]), 'write'),
  'chat.list': define(empty, z.array(schemas.conversationSchema)),
  'chat.create': define(z.strictObject({ title: optionalText }), schemas.conversationSchema, 'write'),
  'chat.update': define(z.strictObject({ id: key, title: optionalText, archived: flag, online: flag }), schemas.conversationSchema, 'write'),
  'chat.read': define(identity, chatData),
  'chat.page': define(z.strictObject({ id: key, before: integer.optional(), watermark: integer.optional(), limit: integer.min(1).max(200).optional() }),
    chatData.extend({ watermark: integer, nextBefore: integer.nullable() })),
  'chat.send': define(z.strictObject({ conversationId: key, text: key, profileId: optionalText, referenceChats: z.array(text).max(10).optional() }), text, 'write'),
  'run.discuss': define(z.strictObject({ id: key, text: key.max(120000), profileId: optionalText, displayedError: text.max(4000).optional(), allowCandidateEdits: z.boolean().optional() }), text, 'write'),
  'chat.retry': define(z.strictObject({ id: key, confirmRetry: z.literal(true, { error: '需要明确确认重新请求，可能产生新的费用' }), profileId: optionalText, referenceChats: z.array(text).max(10).optional() }), text, 'write'),
  'chat.stop': define(empty, ok, 'write'),
  'proposal.create': define(z.strictObject({ conversationId: key, profileId: key, proposal: action }), schemas.actionProposalSchema, 'write'),
  'proposal.refresh': define(z.strictObject({ id: key, profileId: optionalText, proposal: action.partial().optional() }), schemas.actionProposalSchema, 'write'),
  'proposal.confirm': define(z.strictObject({ id: key, version: key, retryUnknown: flag }), z.object({ kind: text, id: text, alreadyExecuted: flag }), 'write'),
  'proposal.cancel': define(identity, schemas.actionProposalSchema, 'write'),
  'draft.list': define(empty, z.array(schemas.draftArtifactSchema)),
  'draft.read': define(z.strictObject({ id: key, hash: optionalText }), draftRead),
  'draft.fork': define(z.object({ id: key, hash: key, title: key.max(80) }).strict(), schemas.draftArtifactSchema, 'write'),
  'draft.merge': define(z.object({ id: key, hash: key, chapter: integer.min(1).max(100000), baseHash: text.nullable(), mode: z.enum(['replace', 'append']) }).strict(), key, 'write'),
  'draft.save': define(z.object({ id: optionalText, title: key.max(80), content: key.max(2_000_000), baseHash: optionalText, conversationId: key, messageId: key }), schemas.draftArtifactSchema, 'write'),
  'draft.promote': define(z.strictObject({ id: key, hash: key, profileId: key, kind: z.enum(['stage', 'revision']).optional(), scope: key }), schemas.actionProposalSchema, 'write'),
  'draft.chapter': define(z.strictObject({ id: key, hash: key, profileId: key }), key, 'write'),
  'assistant.settings': define(empty, settings, 'read', 'global'),
  'assistant.role.save': define(z.strictObject({ id: key, text, source: z.strictObject({ id: key, version: key }).optional() }), settings, 'write', 'global'),
  'assistant.role.reset': define(identity, settings, 'write', 'global'),
  'assistant.role.rollback': define(z.strictObject({ id: key, version: key }), settings, 'write', 'global'),
  'search.settings.save': define(z.strictObject({ search: searchSettingsSchema, apiKey: optionalText, clearKey: flag }), settings, 'write', 'global'),
  'search.test': define(z.strictObject({ profileId: optionalText }), z.object({ ok, results: z.array(z.object({ title: text, url: text, content: text })), query: text, at: text, message: text, credits: z.number().nullable() }), 'remote', 'global'),
  'profiles.save': define(z.strictObject({ profile: profileSchema, apiKey: optionalText }), schemas.profileSchema, 'write', 'global'),
  'profiles.reasoning': define(z.strictObject({ id: key, effort: reasoningEffortSchema.nullable(), expectedVersion: integer, expectedRevision: integer }), schemas.profileSchema, 'write', 'global'),
  'profiles.saveGroup': define(z.strictObject({ connection, models: z.array(model).min(1).max(2000), apiKey: optionalText, expectedProfiles: z.record(text, z.strictObject({ version: integer, enabled: ok })).optional() }), z.array(schemas.profileSchema), 'write', 'global'),
  'profiles.deleteGroup': define(z.strictObject({ id: key, expectedProfiles: z.record(text, z.strictObject({ version: integer, enabled: ok })).optional() }), ok, 'write', 'global'),
  'profiles.delete': define(z.strictObject({ id: key, expectedVersion: integer.optional() }), ok, 'write', 'global'),
  'profiles.test': define(z.strictObject({ id: key, tools: flag }), z.object({ ok, text }), 'remote', 'global'),
  'profiles.models': define(z.strictObject({ id: optionalText, connection: connection.optional(), apiKey: optionalText }), schemas.modelCatalogSchema, 'remote', 'global'),
  'cover.generate': define(z.strictObject({ profileId: key, prompt: key }), z.object({ dataUrl: text, note: text }), 'remote'),
  'cover.cancel': define(empty, ok, 'write'),
  'cover.save': define(z.strictObject({ dataUrl: key, metadata: coverMetadata }), text, 'write'),
  'cover.list': define(empty, z.array(text)),
  'cover.load': define(z.strictObject({ path: key }), coverMetadata)
} as const;

export type Command = keyof typeof commandContracts;
export type CommandInput<C extends Command> = z.input<(typeof commandContracts)[C]['input']>;
export type CommandOutput<C extends Command> = z.output<(typeof commandContracts)[C]['output']>;
export function isCommand(value: unknown): value is Command {
  return typeof value === 'string' && Object.hasOwn(commandContracts, value);
}
export function parseInput<C extends Command>(command: C, value: unknown): CommandInput<C> {
  return commandContracts[command].input.parse(value) as CommandInput<C>;
}
export function parseOutput<C extends Command>(command: C, value: unknown): CommandOutput<C> {
  return commandContracts[command].output.parse(value) as CommandOutput<C>;
}

export interface InvokeOptions { operationId?: string; signal?: AbortSignal; timeoutMs?: number }
export type Invoke = <C extends Command>(command: C, args?: CommandInput<C>, options?: InvokeOptions) => Promise<CommandOutput<C>>;
export const bridgeOptionsSchema = z.strictObject({ operationId: key.max(200).optional(), waitId: text.uuid().optional(), timeoutMs: integer.min(1).max(1_830_000).optional() });
export type BridgeOptions = z.infer<typeof bridgeOptionsSchema>;
export type BridgeResponse = { ok: true; result: unknown } | { ok: false; error: import('./errors').ErrorPayload };
export type BridgeInvoke = <C extends Command>(command: C, args?: CommandInput<C>, options?: BridgeOptions) => Promise<BridgeResponse>;
