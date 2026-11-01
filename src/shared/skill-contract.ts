import { z } from 'zod';

export const skillExecutionSchema = z.object({
  trigger: z.string().min(1), inputs: z.string().min(1), readScope: z.array(z.string()).min(1),
  outputs: z.array(z.string()).min(1), writeScope: z.literal('candidate-only'),
  calls: z.object({ kind: z.enum(['local', 'shared_phase', 'bounded_loop']), minimum: z.number().int().nonnegative(), maximum: z.number().int().nonnegative().nullable() }),
  dependencies: z.array(z.string()).min(1), invalidation: z.array(z.string()).min(1), acceptance: z.array(z.string()).min(1)
});
