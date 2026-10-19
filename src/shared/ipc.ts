import { z } from 'zod';
import { isCommand } from './contracts';
import type { Command } from './contracts';
import { protocolVersion } from './build';
export const requestSchema = z.strictObject({
  protocolVersion: z.literal(protocolVersion), requestId: z.string().uuid(), operationId: z.string().min(1).max(200).optional(),
  workerGeneration: z.number().int().nonnegative(), projectSessionId: z.string().optional(), projectId: z.string().optional(),
  command: z.custom<Command>(isCommand), params: z.unknown()
});
export type RequestEnvelope = z.infer<typeof requestSchema>;
export const rendererContextSchema = z.strictObject({
  operationId: z.string().min(1).max(200).optional(), projectSessionId: z.string().optional(), workerGeneration: z.number().int().optional(),
  waitId: z.string().uuid().optional(), timeoutMs: z.number().int().min(1).max(1_830_000).optional()
});
