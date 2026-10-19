import ts from 'typescript';
import fs from 'node:fs';
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile).config;
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, '.');
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const roots = {};
const nodes = [];
const cache = new Map();
const imports = [];
function encode(type) {
  if (cache.has(type.id)) return cache.get(type.id);
  const index = nodes.length;
  cache.set(type.id, index);
  nodes.push(null);
  const flags = type.flags;
  let node;
  if (flags & ts.TypeFlags.StringLiteral) node = { kind: 'literal', value: type.value };
  else if (flags & ts.TypeFlags.NumberLiteral) node = { kind: 'literal', value: type.value };
  else if (flags & ts.TypeFlags.BooleanLiteral) node = { kind: 'literal', value: type.intrinsicName === 'true' };
  else if (flags & ts.TypeFlags.String) node = { kind: 'string' };
  else if (flags & ts.TypeFlags.Number) node = { kind: 'number' };
  else if (flags & ts.TypeFlags.Boolean) node = { kind: 'boolean' };
  else if (flags & ts.TypeFlags.Null) node = { kind: 'null' };
  else if (flags & ts.TypeFlags.Undefined) node = { kind: 'undefined' };
  else if (flags & ts.TypeFlags.Unknown) node = { kind: 'unknown' };
  else if (flags & ts.TypeFlags.Never) node = { kind: 'never' };
  else if (type.isUnion()) node = { kind: 'union', items: type.types.map(encode) };
  else if (checker.isArrayType(type)) node = { kind: 'array', item: encode(checker.getTypeArguments(type)[0]) };
  else if (checker.isTupleType(type)) node = { kind: 'tuple', items: checker.getTypeArguments(type).map(encode) };
  else if (flags & ts.TypeFlags.Object || type.isIntersection()) {
    const properties = {};
    for (const prop of checker.getPropertiesOfType(type)) {
      const declaration = prop.valueDeclaration ?? prop.declarations?.[0] ?? program.getSourceFile('src/shared/types.ts');
      properties[prop.name] = { type: encode(checker.getTypeOfSymbolAtLocation(prop, declaration)), optional: !!(prop.flags & ts.SymbolFlags.Optional) };
    }
    const indexType = checker.getIndexTypeOfType(type, ts.IndexKind.String) ?? checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    node = { kind: 'object', properties, ...(indexType ? { index: encode(indexType) } : {}) };
  } else throw new Error('Unsupported contract type: ' + checker.typeToString(type));
  nodes[index] = node;
  return index;
}
const selected = {
  types: ['Snapshot', 'Run', 'RunEvent', 'ContextManifest', 'Profile', 'ModelCatalog', 'Fact', 'Issue', 'DocumentInfo'],
  assistant: ['Conversation', 'ConversationMessage', 'ConversationTurn', 'ActionProposal', 'DraftArtifact', 'RoleRule'],
  studio: ['StudioState', 'Assessment', 'EntityState', 'SourceRef', 'SnapshotRef'],
  tags: ['TagCatalog', 'TagKnowledge', 'BookSpec', 'ApprovedTags', 'ContractCandidate'],
  expression: ['ExpressionCatalog']
};
for (const [file, names] of Object.entries(selected)) {
  const source = program.getSourceFile(`src/shared/${file}.ts`);
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
  imports.push(`import type { ${names.join(', ')} } from './${file}';`);
  for (const name of names) {
    const symbol = exports.find((value) => value.name === name);
    roots[name] = encode(checker.getDeclaredTypeOfSymbol(symbol));
  }
}
fs.writeFileSync('src/shared/contract-shapes.json', JSON.stringify({ roots, nodes }));
fs.writeFileSync('src/shared/contract-schemas.ts', [
  "import { z } from 'zod';",
  "import graph from './contract-shapes.json';",
  ...imports,
  "type Shape = { kind: string; value?: string | number | boolean; item?: number; items?: number[]; properties?: Record<string, { type: number; optional: boolean }>; index?: number };",
  "const cache = new Map<number, z.ZodType>();",
  "function build(index: number): z.ZodType {",
  "  if (cache.has(index)) return cache.get(index)!;",
  "  const lazy = z.lazy(() => {",
  "    const node = graph.nodes[index] as Shape;",
  "    switch (node.kind) {",
  "      case 'literal': return z.literal(node.value!);",
  "      case 'string': return z.string();",
  "      case 'number': return z.number();",
  "      case 'boolean': return z.boolean();",
  "      case 'null': return z.null();",
  "      case 'undefined': return z.undefined();",
  "      case 'unknown': return z.unknown();",
  "      case 'never': return z.never();",
  "      case 'union': return z.union(node.items!.map(build));",
  "      case 'array': return z.array(build(node.item!));",
  "      case 'tuple': { const items = node.items!.map(build); return items.length ? z.tuple(items as [z.ZodType, ...z.ZodType[]]) : z.tuple([]); }",
  "      case 'object': {",
  "        const fields = Object.fromEntries(Object.entries(node.properties!).map(([name, prop]) => [name, prop.optional ? build(prop.type).optional() : build(prop.type)]));",
  "        return node.index === undefined ? z.object(fields) : z.object(fields).catchall(build(node.index));",
  "      }",
  "      default: throw new Error('Invalid generated contract schema');",
  "    }",
  "  });",
  "  cache.set(index, lazy);",
  "  return lazy;",
  "}",
  ...Object.keys(roots).map((name) => `export const ${name[0].toLowerCase() + name.slice(1)}Schema = build(graph.roots.${name}) as z.ZodType<${name}>;`),
  ''
].join('\n'));
console.log(`Generated ${Object.keys(roots).length} validated contract roots and ${nodes.length} shapes`);
