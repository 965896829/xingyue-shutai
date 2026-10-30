import { z } from 'zod';
import { reviewAnnotationSchema, reviewPacketSchema, reviewImportSchema } from './blind-review';

const key = z.string().min(1).max(300);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(12000);
export const voiceScopeSchema = z
  .object({
    kind: z.enum(['scene', 'character', 'book']),
    target: z.string().max(300).default(''),
    sceneFunction: key
  })
  .strict();
export const sourceSpanSchema = z
  .object({
    path: key,
    hash: digest,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    quote: z.string().max(12000)
  })
  .strict()
  .refine((s) => s.end >= s.start);
export const editEvidenceSchema = z
  .object({
    usable: z.boolean().optional(),
    id: key,
    version: z.number().int().positive(),
    before: sourceSpanSchema,
    after: sourceSpanSchema,
    scope: voiceScopeSchema,
    domain: z.enum(['expression', 'narrative_focus', 'plot', 'character', 'fact_correction', 'unknown']),
    reason: z.string().max(4000),
    editor: z.enum(['author', 'model', 'imported']),
    state: z.enum(['active', 'retracted']),
    createdAt: key
  })
  .strict();
export const voicePreferenceSchema = z
  .object({
    id: key,
    statement: text,
    scope: voiceScopeSchema,
    evidenceIds: z.array(key).min(1).max(50),
    alternatives: z.array(text).max(20),
    exceptions: z.array(text).max(20),
    state: z.enum(['proposal', 'insufficient_evidence', 'stale']),
    runId: key
  })
  .strict();
export const worldModuleIds = [
  'world-foundation',
  'geography-mobility',
  'history-calendar',
  'society-factions',
  'economy-resources',
  'ability-rules',
  'progression',
  'technology-profession',
  'investigation-evidence',
  'relationship-norms',
  'species-ecology',
  'system-interface'
] as const;
export const worldModuleNames = [
  '世界基础',
  '地理与交通',
  '历史与历法',
  '社会与势力',
  '经济与资源',
  '能力规则',
  '成长体系',
  '技术与职业',
  '调查与证据',
  '关系与习俗',
  '物种与生态',
  '系统界面'
];
export const growthSystemSchema = z.object({
  id: key, title: key, version: z.number().int().positive(), state: z.enum(['enabled', 'disabled', 'undecided']),
  subjects: z.array(key).max(100), fromChapter: z.number().int().nonnegative(), toChapter: z.number().int().nonnegative().nullable(),
  original: z.string().max(50000), unparsed: z.array(text).max(100), locked: z.boolean(),
  steps: z.array(z.object({ id: key, title: key, ability: z.string().max(4000), boundary: z.string().max(4000),
    prerequisites: z.array(key).max(100) }).strict()).max(100),
  interactions: z.array(z.object({ targetSystemId: key, rule: text }).strict()).max(50)
}).strict();
export const worldModelSchema = z
  .object({
    version: z.literal(1),
    source: z.object({ path: key, hash: digest }).nullable(),
    original: z.string(),
    systems: z.array(growthSystemSchema).max(50).optional(),
    modules: z
      .array(
        z
          .object({
            id: key,
            title: key,
            state: z.enum(['enabled', 'disabled', 'undecided']),
            content: z.string().max(50000),
            origin: z.enum(['author', 'inherited', 'proposal']),
            locked: z.boolean(),
            rule: z.strictObject({
              scope: z.string().max(4000), trigger: z.string().max(4000), boundary: z.string().max(4000),
              cost: z.string().max(4000), exception: z.string().max(4000), evidence: z.string().max(4000)
            }).optional()
          })
          .strict()
      )
      .max(100),
    links: z.array(z.strictObject({
      id: key, from: key, to: key, kind: z.enum(['requires', 'enables', 'prevents', 'causes', 'exception']),
      label: z.string().min(1).max(2000)
    })).max(2000).optional(),
    places: z.array(z.strictObject({
      id: key, title: key, description: z.string().max(8000), moduleId: key.optional()
    })).max(1000).optional(),
    routes: z.array(z.strictObject({
      id: key, from: key, to: key, label: z.string().max(2000), direction: z.string().max(200),
      distance: z.strictObject({ value: z.number().nonnegative(), unit: z.string().min(1).max(30) }).nullable()
    })).max(5000).optional()
  })
  .strict();
export const patternSchema = z
  .object({
    id: key,
    chapter: z.number().int().positive(),
    scene: key,
    sources: z.array(sourceSpanSchema).min(1).max(20),
    conflict: text,
    strategy: text,
    response: text,
    solution: text,
    change: text,
    reward: text,
    origin: z.enum(['author', 'model']),
    protectedRepetition: z.enum(['none', 'echo', 'ability_reuse', 'payoff']),
    state: z.enum(['ready', 'stale']),
    runId: z.string()
  })
  .strict();
export const experimentSchema = z
  .object({
    protocolId: z.string().optional(),
    preregistered: z.boolean().default(false),
    id: key,
    title: key,
    kind: z.enum(['voice_fixed_story', 'plot_bounded_changes', 'workflow_continuation']),
    stage: z.enum(['development', 'holdout']),
    family: key,
    sceneFunction: key,
    audience: key,
    variedFactors: z
      .array(z.enum(['model', 'prompt', 'context', 'voice', 'plot', 'revision']))
      .min(1)
      .max(6),
    constraints: text,
    questions: z.array(text).min(1).max(20),
    createdAt: key,
    snapshotId: key,
    candidates: z
      .array(
        z
          .object({
            id: key,
            text,
            hash: digest,
            runId: z.string(),
            provenance: z.record(z.string(), z.string())
          })
          .strict()
      )
      .min(2)
      .max(6)
  })
  .strict();
export const experimentProtocolSchema = experimentSchema
  .omit({ candidates: true, protocolId: true, preregistered: true })
  .extend({
    maxCalls: z.number().int().min(1).max(10000),
    comparisonRule: text,
    exclusionRule: text,
    configurationHash: digest
  });
export const presentationSchema = z
  .object({ id: key, experimentId: key, participant: key, order: z.array(key), createdAt: key })
  .strict();
export const observationSchema = z
  .object({
    id: key,
    presentationId: key,
    origin: z.enum(['human_author', 'human_target_reader', 'model_simulation']),
    outcome: z.enum(['preferred', 'tie', 'both_unsatisfactory', 'abstained']),
    alias: z.string(),
    reason: z.string().max(4000),
    nextQuestion: z.string().max(2000).default(''),
    reading: z.string().max(4000).default(''),
    annotations: z.array(reviewAnnotationSchema).max(20).default([]),
    recruitment: z.string().max(2000),
    excluded: z.string().max(2000),
    state: z.enum(['active', 'withdrawn']),
    createdAt: key
  })
  .strict();
export const qualityStateSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    protocols: z.array(experimentProtocolSchema).default([]),
    reviewPackets: z.array(reviewPacketSchema).default([]),
    reviewImports: z.array(reviewImportSchema).default([]),
    evidence: z.array(editEvidenceSchema),
    preferences: z.array(voicePreferenceSchema),
    patterns: z.array(patternSchema),
    experiments: z.array(experimentSchema),
    presentations: z.array(presentationSchema),
    observations: z.array(observationSchema)
  })
  .strict();
export type QualityState = z.infer<typeof qualityStateSchema>;
export type VoiceScope = z.infer<typeof voiceScopeSchema>;
export type WorldModel = z.infer<typeof worldModelSchema>;
export const qualityMutationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('protocol'),
      protocol: experimentProtocolSchema.omit({
        id: true,
        createdAt: true,
        snapshotId: true,
        configurationHash: true
      })
    })
    .strict(),
  z
    .object({
      kind: z.literal('evidence'),
      evidence: editEvidenceSchema.omit({ id: true, version: true, createdAt: true, state: true, usable: true })
    })
    .strict(),
  z.object({ kind: z.literal('retract'), id: key }).strict(),
  z
    .object({
      kind: z.literal('experiment'),
      experiment: experimentSchema.omit({
        id: true,
        createdAt: true,
        snapshotId: true,
        candidates: true,
        preregistered: true
      }),
      candidates: z
        .array(z.object({ text, runId: z.string().default('') }).strict())
        .min(2)
        .max(6)
    })
    .strict(),
  z.object({ kind: z.literal('present'), experimentId: key, participant: key }).strict(),
  z
    .object({
      kind: z.literal('feedback'),
      observation: observationSchema.omit({ id: true, createdAt: true, state: true })
    })
    .strict(),
  z.object({ kind: z.literal('withdraw'), id: key }).strict(),
  z
    .object({
      kind: z.literal('pattern'),
      pattern: patternSchema.omit({ id: true, state: true, origin: true, runId: true })
    })
    .strict(),
  z
    .object({ kind: z.literal('protect-pattern'), id: key, reason: patternSchema.shape.protectedRepetition })
    .strict()
]);
export type QualityMutation = z.infer<typeof qualityMutationSchema>;
export const qualityStatsSchema = z.object({
  experimentId: key,
  total: z.number(),
  excluded: z.array(z.object({ id: key, reason: z.string() })),
  strata: z.array(
    z.object({
      origin: observationSchema.shape.origin,
      participants: z.number(),
      comparisons: z.number(),
      wins: z.record(z.string(), z.number()),
      ties: z.number(),
      unsatisfactory: z.number(),
      abstentions: z.number()
    })
  ),
  hash: digest
});
