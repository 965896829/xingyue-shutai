import { z } from 'zod';
import { narrativeEventRecordSchema, narrativeRecordSchema } from '../shared/narrative-curve';

const vector = z.object({ generation: z.string(), status: z.string(), count: z.number(), watermark: z.string().nullable(), error: z.string().optional() }).nullable();
const identity = z.object({ draftId: z.string(), projectId: z.string(), snapshotId: z.string(), hash: z.string(), epoch: z.string(), draftVersion: z.number() }).nullable();

export function panelRecordSchema(key: string) {
  if (key === 'vectorIndex') return vector;
  if (key.startsWith('narrative:')) return key.startsWith('narrative:events:') ? narrativeEventRecordSchema : narrativeRecordSchema;
  if (key.startsWith('candidateIdentity:')) return identity;
}
