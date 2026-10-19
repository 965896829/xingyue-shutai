import fs from 'node:fs';
import { z } from 'zod';
import { atomicWrite } from './storage';
import { id } from './domain';

export function readSettings<T>(file: string, schema: z.ZodType<T>, fallback: T) {
  if (!fs.existsSync(file)) return { value: fallback, recovered: false };
  const original = fs.readFileSync(file);
  try { return { value: schema.parse(JSON.parse(original.toString('utf8'))), recovered: false }; }
  catch {
    const preserved = `${file}.unreadable-${id()}`;
    atomicWrite(preserved, original);
    return { value: fallback, recovered: true, preserved };
  }
}
