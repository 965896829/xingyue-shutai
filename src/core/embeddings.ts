import { z } from 'zod';
import { embeddingSettingsSchema, type EmbeddingSettings, type MemoryScope } from '../shared/studio';
import { FileStore } from './storage';
import { hash } from './domain';
import { boundedBody, endpoint, RequestError } from './provider';
import { retrieveMemory, scopeSnapshot, visibleFact, sourceValid, conflictingFacts } from './memory-studio';
import { primaryPath } from './memory';
import type { Usage } from '../shared/types';
export interface RetrievalBudget {
  remaining: number | null;
  currency: string;
}

export interface EmbeddingAdapter {
  embed(input: string[], signal: AbortSignal): Promise<{ vectors: number[][]; tokens: number | null }>;
}
export class CompatibleEmbeddings implements EmbeddingAdapter {
  constructor(
    readonly settings: EmbeddingSettings,
    readonly apiKey: string
  ) {}
  async embed(input: string[], signal: AbortSignal) {
    const s = this.settings;
    if (!s.model || !this.apiKey) throw new Error('请先配置语义检索模型和 Key');
    if (
      !input.length ||
      input.some((t) => !t.trim()) ||
      Buffer.byteLength(JSON.stringify(input)) > s.inputBudget
    )
      throw new Error('语义检索输入超过配置预算');
    const url = endpoint(s, 'embeddings');
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(s.timeoutSeconds * 1000)]),
        body: JSON.stringify({
          model: s.model,
          input,
          encoding_format: 'float',
          ...(s.sendDimensions && s.dimensions ? { dimensions: s.dimensions } : {})
        })
      });
    } catch {
      throw new RequestError('语义检索请求结果未知，未自动重试', true);
    }
    if (!response.ok) throw new RequestError(`语义检索服务返回 ${response.status}`, response.status >= 500);
    try {
      const raw = JSON.parse((await boundedBody(response.body, 16_000_000)).toString('utf8'));
      const parsed = z
        .object({
          data: z.array(
            z.object({
              index: z.number().int().nonnegative(),
              embedding: z.array(z.number().finite()).min(1)
            })
          ),
          usage: z.object({ total_tokens: z.number().nonnegative().optional() }).optional()
        })
        .parse(raw);
      const rows = parsed.data.sort((a, b) => a.index - b.index);
      if (
        rows.length !== input.length ||
        rows.some((r, i) => r.index !== i) ||
        new Set(rows.map((r) => r.embedding.length)).size !== 1
      )
        throw new Error('向量响应数量或维度不一致');
      if (s.dimensions && rows[0].embedding.length !== s.dimensions) throw new Error('向量维度与设置不一致');
      if (rows.some((r) => r.embedding.every((v) => v === 0))) throw new Error('向量响应不能全部为零');
      return { vectors: rows.map((r) => r.embedding), tokens: parsed.usage?.total_tokens ?? null };
    } catch (error) {
      throw new RequestError(`${(error as Error).message}；语义检索费用未知`, true);
    }
  }
}
export interface VectorAdapter {
  rank(
    query: number[],
    rows: { id: string; vector: number[] }[],
    limit: number
  ): { id: string; score: number }[];
}
export class LocalCosine implements VectorAdapter {
  rank(query: number[], rows: { id: string; vector: number[] }[], limit: number) {
    const norm = Math.sqrt(query.reduce((s, v) => s + v * v, 0));
    return rows
      .filter((r) => r.vector.length === query.length)
      .map((r) => ({
        id: r.id,
        score:
          r.vector.reduce((s, v, i) => s + v * query[i], 0) /
          (norm * Math.sqrt(r.vector.reduce((s, v) => s + v * v, 0)) || 1)
      }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }
}
export function proseChunks(text: string, maxPoints = 600) {
  const chars = Array.from(text),
    chunks: { start: number; end: number; text: string }[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = Math.min(chars.length, start + maxPoints);
    if (end < chars.length) {
      const part = chars.slice(start, end).join(''),
        split = part.lastIndexOf('\n\n');
      if (split > part.length / 3) end = start + Array.from(part.slice(0, split + 2)).length;
    }
    const value = chars.slice(start, end).join('');
    if (value.trim()) chunks.push({ start, end, text: value });
    start = end;
  }
  return chunks;
}
export class SemanticIndex {
  controller: AbortController | null = null;
  constructor(
    readonly store: FileStore,
    readonly settings: () => { settings: EmbeddingSettings; apiKey: string },
    readonly changed: () => void,
    readonly adapter?: EmbeddingAdapter
  ) {}
  private configuration() {
    const v = this.settings(),
      settings = embeddingSettingsSchema.parse(v.settings);
    const generation = hash(
      JSON.stringify({
        url: settings.baseUrl,
        model: settings.model,
        dimensions: settings.dimensions,
        scope: settings.dataScope,
        chunker: 'paragraph-cp-1'
      })
    );
    return { settings, generation, adapter: this.adapter ?? new CompatibleEmbeddings(settings, v.apiKey) };
  }
  stop() {
    this.controller?.abort();
  }
  async rebuild() {
    if (this.controller) throw new Error('语义索引正在更新');
    const { settings, generation, adapter } = this.configuration();
    this.store.db.set('vectorQueryBlocked', false);
    if (!settings.enabled) throw new Error('请先启用语义检索');
    const snapshot = this.store.db.head()!,
      controller = new AbortController();
    this.controller = controller;
    const old = this.store.db.get<{ observedDimensions?: number; generation: string }>('vectorIndex');
    const state = {
      generation,
      status: 'building',
      watermark: null as string | null,
      count: 0,
      error: undefined as string | undefined,
      observedDimensions: old?.generation === generation ? old.observedDimensions : undefined,
      tokens: 0 as number | null,
      cost: 0 as number | null
    };
    this.store.db.set('vectorIndex', state);
    this.changed();
    try {
      for (const [file, version] of Object.entries(snapshot.documents)) {
        if (controller.signal.aborted) throw new Error('索引更新已停止');
        const chapter = Number(file.match(/第(\d+)章/)?.[1] ?? 0);
        if (!(file.startsWith('07_') && snapshot.project.chapters[chapter])) continue;
        const maxPoints = Math.max(16, Math.min(600, Math.floor((settings.inputBudget - 32) / 6)));
        for (const chunk of proseChunks(this.store.object(version).toString('utf8'), maxPoints)) {
          const key = hash(`${generation}:${file}:${version}:${chunk.start}:${chunk.end}`);
          if (this.store.db.sql.prepare('SELECT 1 FROM vector_chunks WHERE id=?').get(key)) continue;
          const result = await adapter.embed([chunk.text], controller.signal);
          if (controller.signal.aborted) throw new Error('索引更新已停止');
          const vector = result.vectors[0];
          if (state.observedDimensions && vector.length !== state.observedDimensions)
            throw new Error('服务模型维度改变，请新建索引');
          state.observedDimensions = vector.length;
          state.tokens =
            state.tokens === null || result.tokens === null ? null : state.tokens + result.tokens;
          state.cost =
            state.tokens === null || settings.price === null ? null : (state.tokens * settings.price) / 1e6;
          if (this.store.db.document(file)?.hash !== version) continue;
          this.store.db.sql
            .prepare('INSERT OR IGNORE INTO vector_chunks VALUES(?,?,?,?,?,?,?,?,?)')
            .run(
              key,
              generation,
              file,
              version,
              chapter,
              chunk.start,
              chunk.end,
              chunk.text,
              JSON.stringify(vector)
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (settings.dataScope === 'prose-and-memory')
        for (const fact of snapshot.facts.filter(
          (f) => f.reviewStatus === 'accepted' && f.state !== 'disputed'
        )) {
          if (controller.signal.aborted) throw new Error('索引更新已停止');
          const version = hash(JSON.stringify(fact)),
            key = 'fact:' + hash(`${generation}:${fact.id}:${version}`);
          if (this.store.db.sql.prepare('SELECT 1 FROM vector_chunks WHERE id=?').get(key)) continue;
          const text = `${fact.subject} ${fact.predicate} ${fact.value}\n${fact.evidence.map((e) => e.quote).join('\n')}`;
          const result = await adapter.embed([text], controller.signal),
            vector = result.vectors[0];
          if (state.observedDimensions && vector.length !== state.observedDimensions)
            throw new Error('服务模型维度改变，请新建索引');
          state.observedDimensions = vector.length;
          state.tokens =
            state.tokens === null || result.tokens === null ? null : state.tokens + result.tokens;
          state.cost =
            state.tokens === null || settings.price === null ? null : (state.tokens * settings.price) / 1e6;
          this.store.db.sql
            .prepare('INSERT OR IGNORE INTO vector_chunks VALUES(?,?,?,?,?,?,?,?,?)')
            .run(
              key,
              generation,
              primaryPath(fact),
              version,
              fact.fromChapter,
              0,
              Array.from(text).length,
              text,
              JSON.stringify(vector)
            );
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      state.status = this.store.db.get('headSnapshot') === snapshot.id ? 'ready' : 'stale';
      state.watermark = snapshot.id;
    } catch (e) {
      state.status = e instanceof RequestError && e.uncertain ? 'unknown' : 'paused';
      if (state.status === 'unknown') {
        state.cost = null;
        state.tokens = null;
      }
      state.error = (e as Error).message;
    } finally {
      state.count = Number(
        (
          this.store.db.sql
            .prepare('SELECT count(*) AS n FROM vector_chunks WHERE generation=?')
            .get(generation) as { n: number }
        ).n
      );
      this.store.db.set('vectorIndex', state);
      this.controller = null;
      this.changed();
    }
    return state;
  }
  async retrieve(
    query: string,
    scope: MemoryScope,
    limit = 20,
    budget?: RetrievalBudget
  ): Promise<ReturnType<typeof retrieveMemory> & { semantic: string; usage?: Usage }> {
    const exact = retrieveMemory(this.store, query, scope, limit),
      { settings, generation, adapter } = this.configuration();
    if (!settings.enabled || !query.trim() || scope.viewpoint === 'character')
      return { ...exact, semantic: 'disabled' };
    const index = this.store.db.get<{ generation: string; status: string; observedDimensions?: number }>(
      'vectorIndex'
    );
    if (index?.generation !== generation || !index.observedDimensions)
      return { ...exact, semantic: 'degraded' };
    if (this.store.db.get('vectorQueryBlocked')) return { ...exact, semantic: 'degraded' };
    if (
      budget &&
      (budget.remaining === null ||
        settings.price === null ||
        budget.currency !== settings.currency ||
        (Buffer.byteLength(JSON.stringify([query])) * settings.price) / 1e6 > budget.remaining)
    )
      return { ...exact, semantic: 'budget-limited' };
    let usage: Usage | undefined;
    try {
      const result = await adapter.embed([query], new AbortController().signal);
      usage = {
        input: result.tokens,
        output: 0,
        cost:
          result.tokens !== null && settings.price !== null ? (result.tokens * settings.price) / 1e6 : null,
        currency: settings.currency
      };
      if (result.vectors[0].length !== index.observedDimensions) throw new Error('查询向量维度不一致');
      const snapshot = scopeSnapshot(this.store, scope);
      const conflicts = conflictingFacts(snapshot.facts.filter((f) => visibleFact(f, scope)));
      const factMap = new Map(
        snapshot.facts
          .filter(
            (f) =>
              visibleFact(f, scope) &&
              !conflicts.has(f.id) &&
              f.evidence.every((e) => sourceValid(this.store, e, snapshot.documents, scope.chapter))
          )
          .map((f) => ['fact:' + hash(`${generation}:${f.id}:${hash(JSON.stringify(f))}`), f])
      );
      const rows = (
        this.store.db.sql
          .prepare(
            'SELECT id,path,hash,chapter,start,end,text,vector FROM vector_chunks WHERE generation=? AND chapter<=?'
          )
          .all(generation, scope.chapter) as {
          id: string;
          path: string;
          hash: string;
          chapter: number;
          start: number;
          end: number;
          text: string;
          vector: string;
        }[]
      ).filter((r) =>
        r.id.startsWith('fact:')
          ? factMap.has(r.id)
          : snapshot.documents[r.path] === r.hash &&
            r.path.startsWith('07_') &&
            !!snapshot.project.chapters[r.chapter]
      );
      const ranks = new LocalCosine().rank(
        result.vectors[0],
        rows.map((r) => ({ id: r.id, vector: JSON.parse(r.vector) })),
        limit
      );
      const scores = new Map<string, { score: number; doc: (typeof exact.documents)[number] }>();
      exact.documents.forEach((doc, i) => scores.set(doc.path, { score: 1 / (60 + i + 1), doc }));
      const facts = new Map(exact.facts.map((f, i) => [f.fact.id, { ...f, score: 1 / (60 + i + 1) }]));
      ranks.forEach((rank, i) => {
        const row = rows.find((r) => r.id === rank.id)!;
        const fact = factMap.get(row.id);
        if (fact) {
          const old = facts.get(fact.id);
          facts.set(
            fact.id,
            old
              ? { ...old, score: old.score + 1 / (60 + i + 1) }
              : { fact, score: 1 / (60 + i + 1), required: false, reason: '语义关联' }
          );
          return;
        }
        const old = scores.get(row.path);
        scores.set(row.path, {
          score: (old?.score ?? 0) + 1 / (60 + i + 1),
          doc: old?.doc ?? {
            path: row.path,
            hash: row.hash,
            excerpt: row.text,
            reason: '语义关联',
            start: row.start,
            end: row.end
          }
        });
      });
      const ranked = [...facts.values()].sort((a, b) => b.score - a.score);
      return {
        ...exact,
        facts: [...ranked.filter((f) => f.required), ...ranked.filter((f) => !f.required).slice(0, limit)],
        documents: [...scores.values()]
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((x) => x.doc),
        usage,
        semantic: index.status === 'ready' ? 'ready' : 'degraded'
      };
    } catch (e) {
      if (e instanceof RequestError && e.uncertain) {
        this.store.db.set('vectorQueryBlocked', true);
        return {
          ...exact,
          semantic: 'degraded',
          usage: { input: null, output: null, cost: null, currency: settings.currency } as Usage
        };
      }
      return { ...exact, semantic: 'degraded', usage };
    }
  }
}
