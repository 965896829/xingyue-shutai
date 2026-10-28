import { z } from 'zod';
import graph from './contract-shapes.json';
import type { Snapshot, Run, RunEvent, ContextManifest, Profile, ModelCatalog, Fact, DocumentInfo } from './types';
import type { Conversation, ConversationMessage, ConversationTurn, ActionProposal, DraftArtifact, RoleRule } from './assistant';
import type { StudioState, Assessment, EntityState, SourceRef, SnapshotRef } from './studio';
import type { TagCatalog, TagKnowledge, BookSpec, ApprovedTags, ContractCandidate } from './tags';
import type { ExpressionCatalog } from './expression';
type Shape = { kind: string; value?: string | number | boolean; item?: number; items?: number[]; properties?: Record<string, { type: number; optional: boolean }>; index?: number };
const cache = new Map<number, z.ZodType>();
function build(index: number): z.ZodType {
  if (cache.has(index)) return cache.get(index)!;
  const lazy = z.lazy(() => {
    const node = graph.nodes[index] as Shape;
    switch (node.kind) {
      case 'literal': return z.literal(node.value!);
      case 'string': return z.string();
      case 'number': return z.number();
      case 'boolean': return z.boolean();
      case 'null': return z.null();
      case 'undefined': return z.undefined();
      case 'unknown': return z.unknown();
      case 'never': return z.never();
      case 'union': return z.union(node.items!.map(build));
      case 'array': return z.array(build(node.item!));
      case 'tuple': { const items = node.items!.map(build); return items.length ? z.tuple(items as [z.ZodType, ...z.ZodType[]]) : z.tuple([]); }
      case 'object': {
        const fields = Object.fromEntries(Object.entries(node.properties!).map(([name, prop]) => [name, prop.optional ? build(prop.type).optional() : build(prop.type)]));
        return node.index === undefined ? z.object(fields) : z.object(fields).catchall(build(node.index));
      }
      default: throw new Error('Invalid generated contract schema');
    }
  });
  cache.set(index, lazy);
  return lazy;
}
export const snapshotSchema = build(graph.roots.Snapshot) as z.ZodType<Snapshot>;
export const runSchema = build(graph.roots.Run) as z.ZodType<Run>;
export const runEventSchema = build(graph.roots.RunEvent) as z.ZodType<RunEvent>;
export const contextManifestSchema = build(graph.roots.ContextManifest) as z.ZodType<ContextManifest>;
export const profileSchema = build(graph.roots.Profile) as z.ZodType<Profile>;
export const modelCatalogSchema = build(graph.roots.ModelCatalog) as z.ZodType<ModelCatalog>;
export const factSchema = build(graph.roots.Fact) as z.ZodType<Fact>;
export const documentInfoSchema = build(graph.roots.DocumentInfo) as z.ZodType<DocumentInfo>;
export const conversationSchema = build(graph.roots.Conversation) as z.ZodType<Conversation>;
export const conversationMessageSchema = build(graph.roots.ConversationMessage) as z.ZodType<ConversationMessage>;
export const conversationTurnSchema = build(graph.roots.ConversationTurn) as z.ZodType<ConversationTurn>;
export const actionProposalSchema = build(graph.roots.ActionProposal) as z.ZodType<ActionProposal>;
export const draftArtifactSchema = build(graph.roots.DraftArtifact) as z.ZodType<DraftArtifact>;
export const roleRuleSchema = build(graph.roots.RoleRule) as z.ZodType<RoleRule>;
export const studioStateSchema = build(graph.roots.StudioState) as z.ZodType<StudioState>;
export const assessmentSchema = build(graph.roots.Assessment) as z.ZodType<Assessment>;
export const entityStateSchema = build(graph.roots.EntityState) as z.ZodType<EntityState>;
export const sourceRefSchema = build(graph.roots.SourceRef) as z.ZodType<SourceRef>;
export const snapshotRefSchema = build(graph.roots.SnapshotRef) as z.ZodType<SnapshotRef>;
export const tagCatalogSchema = build(graph.roots.TagCatalog) as z.ZodType<TagCatalog>;
export const tagKnowledgeSchema = build(graph.roots.TagKnowledge) as z.ZodType<TagKnowledge>;
export const bookSpecSchema = build(graph.roots.BookSpec) as z.ZodType<BookSpec>;
export const approvedTagsSchema = build(graph.roots.ApprovedTags) as z.ZodType<ApprovedTags>;
export const contractCandidateSchema = build(graph.roots.ContractCandidate) as z.ZodType<ContractCandidate>;
export const expressionCatalogSchema = build(graph.roots.ExpressionCatalog) as z.ZodType<ExpressionCatalog>;
