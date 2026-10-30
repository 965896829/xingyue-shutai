from pathlib import Path
import argparse
import hashlib
import io
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import tokenize


def run(args):
    package = args.package_root.resolve()
    work = args.work_dir.resolve()
    work.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='v3-contract-', dir=work))
    database = temporary / 'contract-check.sqlite'
    db = sqlite3.connect(database, isolation_level=None)
    schema_path = package / 'vnext/memory-schema-v3.sql'
    schema = schema_path.read_text(encoding='utf-8')
    checks = []
    digest = 'a' * 64
    timestamp = '2026-10-28T00:00:00Z'

    def accept(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append({'check': name, 'passed': True})

    def insert(table, values):
        names = ','.join(values)
        marks = ','.join('?' for _ in values)
        db.execute(f'INSERT INTO {table}({names}) VALUES ({marks})', tuple(values.values()))

    def reject_statement(name, statement, values):
        db.execute('SAVEPOINT invalid_case')
        try:
            db.execute(statement, values)
            db.execute('RELEASE invalid_case')
        except sqlite3.IntegrityError:
            db.execute('ROLLBACK TO invalid_case')
            db.execute('RELEASE invalid_case')
            checks.append({'check': name, 'passed': True})
        else:
            raise AssertionError(name)

    def reject(name, table, values):
        names = ','.join(values)
        marks = ','.join('?' for _ in values)
        reject_statement(name, f'INSERT INTO {table}({names}) VALUES ({marks})', tuple(values.values()))

    db.execute('CREATE TABLE existing_authority_probe(id TEXT PRIMARY KEY, body TEXT NOT NULL)')
    db.execute('INSERT INTO existing_authority_probe VALUES (?,?)', ('chapter-1', '甲😀𠮷乙'))
    db.executescript(schema)
    objects = db.execute("SELECT type,name,sql FROM sqlite_master WHERE name LIKE 'v3_%' ORDER BY type,name").fetchall()
    db.executescript(schema)
    accept('schema-repeat-preserves-object-definitions', objects == db.execute("SELECT type,name,sql FROM sqlite_master WHERE name LIKE 'v3_%' ORDER BY type,name").fetchall())
    accept('foreign-keys-enabled', db.execute('PRAGMA foreign_keys').fetchone()[0] == 1)

    for branch, project, revision in [('main', 'p', 'r1'), ('other', 'p2', 'r2')]:
        insert('v3_memory_branch', dict(id=branch, project_id=project, overlay_manifest_hash=digest))
        insert('v3_memory_revision', dict(id=revision, branch_id=branch, sequence=1,
            authority_changeset_id=f'cs-{revision}', recorded_at=timestamp))
        db.execute('UPDATE v3_memory_branch SET head_revision_id=? WHERE id=?', (revision, branch))
    reject('reject-null-text-primary-key', 'v3_memory_branch', dict(id=None, project_id='p', overlay_manifest_hash=digest))
    reject('reject-fractional-revision-sequence', 'v3_memory_revision', dict(id='r-fraction', branch_id='main',
        sequence=1.5, authority_changeset_id='cs-fraction', recorded_at=timestamp))
    reject('reject-cross-project-overlay', 'v3_memory_overlay', dict(project_id='p', branch_id='main',
        ancestor_branch_id='other', through_revision_id='r2', precedence=1))
    reject('reject-fork-revision-from-wrong-parent', 'v3_memory_branch', dict(id='bad-child', project_id='p',
        parent_branch_id='main', fork_revision_id='r2', overlay_manifest_hash=digest))
    insert('v3_memory_branch', dict(id='child', project_id='p', parent_branch_id='main',
        fork_revision_id='r1', overlay_manifest_hash=digest))
    insert('v3_memory_overlay', dict(project_id='p', branch_id='child', ancestor_branch_id='main',
        through_revision_id='r1', precedence=1))
    accept('valid-fork-pins-parent-revision', db.execute("SELECT through_revision_id FROM v3_memory_overlay WHERE branch_id='child'").fetchone()[0] == 'r1')

    source = dict(id='s1', project_id='p', branch_id='main', revision_id='r1', owner='existing_document',
        existing_source_id='chapter-1', existing_snapshot_id='snapshot-1', path='chapters/1.md',
        body_hash=digest, accepted=1, source_role='original', recorded_at=timestamp)
    insert('v3_memory_source_version', source)
    insert('v3_memory_source_version', {**source, 'id': 's2', 'owner': 'existing_fact_document',
        'source_role': 'legacy_fact_document', 'existing_source_id': 'legacy-facts', 'path': 'facts/1.md'})
    reject('reject-ledger-as-original-source', 'v3_memory_source_version', {**source, 'id': 'bad-source-role',
        'existing_source_id': 'bad-ledger', 'owner': 'existing_fact_document'})
    reject('reject-cross-project-source', 'v3_memory_source_version', {**source, 'id': 'bad-project-source',
        'existing_source_id': 'bad-source', 'project_id': 'p2'})
    evidence = dict(id='e1', source_version_id='s1', offset_unit='unicode_codepoint', start_offset=1,
        end_offset=2, quote='😀', quote_hash=hashlib.sha256('😀'.encode()).hexdigest())
    insert('v3_memory_evidence', evidence)
    insert('v3_memory_evidence', {**evidence, 'id': 'e2', 'start_offset': 2, 'end_offset': 3,
        'quote': '𠮷', 'quote_hash': hashlib.sha256('𠮷'.encode()).hexdigest()})
    reject('reject-non-codepoint-unit', 'v3_memory_evidence', {**evidence, 'id': 'bad-unit', 'offset_unit': 'utf16'})
    reject('reject-reversed-span', 'v3_memory_evidence', {**evidence, 'id': 'bad-span', 'end_offset': 0})
    reject('reject-fractional-codepoint', 'v3_memory_evidence', {**evidence, 'id': 'bad-fraction', 'start_offset': 0.5})
    reject('reject-missing-evidence-source', 'v3_memory_evidence', {**evidence, 'id': 'bad-source', 'source_version_id': 'missing'})
    accept('astral-character-evidence-uses-codepoints', '甲😀𠮷乙'[evidence['start_offset']:evidence['end_offset']] == evidence['quote'])

    insert('v3_memory_read_set', dict(id='rs1', scope_json='{}', source_set_hash=digest, predicate_epoch_hash=digest))
    artifact = dict(id='art1', project_id='p', branch_id='main', revision_id='r1', kind='character', scope_json='{}',
        payload_schema_id='character-v3', payload_ref='existing-candidate-1', read_set_id='rs1',
        through_event_sequence=0, input_hash=digest, compiler_version='v3-design', state='building')
    insert('v3_memory_artifact', artifact)
    accept('building-projection-permits-null-output-hash', db.execute("SELECT output_hash FROM v3_memory_artifact WHERE id='art1'").fetchone()[0] is None)
    reject('reject-ready-projection-without-output-hash', 'v3_memory_artifact', {**artifact, 'id': 'bad-ready', 'state': 'ready'})
    reject('reject-unknown-artifact-kind', 'v3_memory_artifact', {**artifact, 'id': 'bad-artifact-kind', 'kind': 'memory_magic'})
    db.execute("UPDATE v3_memory_artifact SET state='ready',output_hash=? WHERE id='art1'", (digest,))
    claim = dict(id='c1', project_id='p', branch_id='main', revision_id='r1', existing_fact_id='core-f1',
        existing_fact_hash=digest, legacy_fact_document_version_id=None, authority_changeset_id='cs-r1',
        kind='world', lane='accepted', subject_entity_id='actor-1', predicate='owns', cached_value_json='"钥匙"',
        epistemic_json='{"kind":"world"}', revealed_chapter_id='chapter-1', revealed_chapter_order=1,
        revealed_scene_id='scene-1', revealed_scene_order=0, revealed_event_order=0, revealed_codepoint=0,
        story_window_json='{"precision":"unknown"}', evidence_ids_json='["e1"]', related_claim_ids_json='[]')
    insert('v3_memory_claim_projection', claim)
    accept('accepted-claim-permits-null-legacy-ledger', db.execute("SELECT legacy_fact_document_version_id FROM v3_memory_claim_projection WHERE id='c1'").fetchone()[0] is None)
    accept('claim-evidence-reverse-index-created', db.execute("SELECT evidence_id FROM v3_memory_claim_evidence WHERE claim_id='c1'").fetchall() == [('e1',)])
    for name, override in [
        ('reject-accepted-without-changeset', {'authority_changeset_id': None}),
        ('reject-candidate-without-candidate-binding', {'lane': 'candidate', 'authority_changeset_id': None}),
        ('reject-derived-without-artifact', {'lane': 'derived', 'authority_changeset_id': None}),
        ('reject-fabricated-candidate-adoption', {'lane': 'candidate', 'existing_candidate_id': 'candidate-2'}),
        ('reject-missing-derivation-artifact', {'lane': 'derived', 'authority_changeset_id': None, 'derivation_artifact_id': 'missing'}),
        ('reject-belief-without-holder', {'kind': 'belief', 'epistemic_json': '{"kind":"belief"}'}),
        ('reject-utterance-without-speaker', {'kind': 'utterance', 'epistemic_json': '{"kind":"utterance"}'}),
        ('reject-epistemic-kind-mismatch', {'epistemic_json': '{"kind":"belief"}'}),
        ('reject-missing-evidence-link', {'evidence_ids_json': '["missing"]'}),
        ('reject-scalar-evidence-array', {'evidence_ids_json': '{}'}),
        ('reject-duplicate-evidence-link', {'evidence_ids_json': '["e1","e1"]'}),
        ('reject-non-array-related-claims', {'related_claim_ids_json': '{}'})
    ]:
        reject(name, 'v3_memory_claim_projection', {**claim, 'id': name, 'existing_fact_id': name, **override})
    insert('v3_memory_claim_projection', {**claim, 'id': 'candidate-claim', 'existing_fact_id': 'candidate-fact',
        'lane': 'candidate', 'authority_changeset_id': None, 'existing_candidate_id': 'candidate-1'})
    insert('v3_memory_claim_projection', {**claim, 'id': 'derived-claim', 'existing_fact_id': 'derived-fact',
        'lane': 'derived', 'authority_changeset_id': None, 'derivation_artifact_id': 'art1'})
    accept('three-publication-lanes-have-distinct-bindings', db.execute('SELECT count(DISTINCT lane) FROM v3_memory_claim_projection').fetchone()[0] == 3)
    for kind, epistemic, fields in [
        ('belief', {'kind': 'belief', 'holderActorId': 'actor-1', 'stance': 'suspects'}, {'holder_actor_id': 'actor-1'}),
        ('utterance', {'kind': 'utterance', 'speakerActorId': 'actor-1', 'utteredProposition': '钥匙不在我这里'}, {'speaker_actor_id': 'actor-1'}),
        ('inference', {'kind': 'inference', 'producer': 'model', 'derivedFromRefIds': ['e1']}, {}),
        ('plan', {'kind': 'plan', 'owner': {'kind': 'author'}}, {})
    ]:
        insert('v3_memory_claim_projection', {**claim, 'id': f'c-{kind}', 'existing_fact_id': f'fact-{kind}',
            'kind': kind, 'epistemic_json': json.dumps(epistemic), **fields})
    accept('five-proposition-kinds-stored-distinctly', db.execute('SELECT count(DISTINCT kind) FROM v3_memory_claim_projection').fetchone()[0] == 5)
    db.execute("UPDATE v3_memory_claim_projection SET evidence_ids_json='[\"e2\"]' WHERE id='c1'")
    accept('claim-evidence-update-replaces-reverse-links', db.execute("SELECT evidence_id FROM v3_memory_claim_evidence WHERE claim_id='c1'").fetchall() == [('e2',)])
    reject_statement('reject-invalid-evidence-update-atomically', "UPDATE v3_memory_claim_projection SET evidence_ids_json=? WHERE id='c1'", ('["missing"]',))
    accept('failed-evidence-update-preserves-old-index', db.execute("SELECT evidence_id FROM v3_memory_claim_evidence WHERE claim_id='c1'").fetchall() == [('e2',)])
    accept('original-source-to-claim-retrieval-without-ledger', db.execute("SELECT DISTINCT c.id FROM v3_memory_evidence e JOIN v3_memory_claim_evidence x ON x.evidence_id=e.id JOIN v3_memory_claim_projection c ON c.id=x.claim_id WHERE e.source_version_id='s1' AND c.id='c1'").fetchall() == [('c1',)])

    dependency = dict(id='d1', read_set_id='rs1', kind='absence', query_fingerprint=digest,
        predicate_json='{"predicate":"knows"}', partition_epochs_json='{"project:*":1}')
    reject('reject-absence-with-null-completeness', 'v3_memory_dependency', dependency)
    reject('reject-truncated-query-as-absence', 'v3_memory_dependency', {**dependency, 'complete_within_scope': 0, 'expected_empty': 1})
    reject('reject-absence-without-query-epochs', 'v3_memory_dependency', {**dependency,
        'partition_epochs_json': None, 'complete_within_scope': 1, 'expected_empty': 1})
    insert('v3_memory_dependency', {**dependency, 'complete_within_scope': 1, 'expected_empty': 1})
    predicate_dependency = {**dependency, 'id': 'd-predicate', 'kind': 'predicate',
        'complete_within_scope': 0, 'result_ids_json': '["c1"]', 'result_set_hash': digest}
    reject('reject-predicate-without-result-binding', 'v3_memory_dependency', {**predicate_dependency, 'result_set_hash': None})
    reject('reject-predicate-without-completeness-marker', 'v3_memory_dependency', {**predicate_dependency, 'complete_within_scope': None})
    insert('v3_memory_dependency', predicate_dependency)
    accept('predicate-result-and-partition-epochs-persist-together', db.execute("SELECT result_ids_json,partition_epochs_json FROM v3_memory_dependency WHERE id='d-predicate'").fetchone() == ('["c1"]', '{"project:*":1}'))
    insert('v3_memory_partition_epoch', dict(branch_id='main', partition_key='actor-1:belief', epoch=0))
    reject('reject-fractional-partition-epoch', 'v3_memory_partition_epoch', dict(branch_id='main', partition_key='bad', epoch=0.5))

    job = dict(id='j1', project_id='p', branch_id='main', kind='project', authority_changeset_id='cs-r1',
        expected_revision_id='r1', idempotency_key=digest, payload_ref='art1', state='queued',
        payload_hash=digest, retry_disposition='local_retry')
    insert('v3_memory_outbox', job)
    reject('reject-duplicate-job-key', 'v3_memory_outbox', {**job, 'id': 'j-duplicate'})
    reject('reject-fractional-job-attempt', 'v3_memory_outbox', {**job, 'id': 'j-fraction', 'idempotency_key': 'j-fraction', 'attempt': 0.5})
    reject('reject-unknown-outcome-local-retry', 'v3_memory_outbox', {**job, 'id': 'j-unknown-local',
        'idempotency_key': 'j-unknown-local', 'state': 'outcome_unknown', 'existing_run_attempt_id': 'gateway-attempt-1'})
    reject('reject-unknown-outcome-without-gateway-attempt', 'v3_memory_outbox', {**job, 'id': 'j-unknown-unbound',
        'idempotency_key': 'j-unknown-unbound', 'state': 'outcome_unknown', 'retry_disposition': 'manual_review'})
    for mode in ['gateway_managed', 'manual_review']:
        insert('v3_memory_outbox', {**job, 'id': f'j-unknown-{mode}', 'idempotency_key': f'unknown-{mode}',
            'state': 'outcome_unknown', 'existing_run_attempt_id': 'gateway-attempt-1', 'retry_disposition': mode})
    insert('v3_memory_outbox', {**job, 'id': 'j-cancelled', 'idempotency_key': 'cancelled', 'state': 'cancelled'})
    accept('unknown-outcomes-remain-gateway-bound', db.execute("SELECT count(*) FROM v3_memory_outbox WHERE state='outcome_unknown' AND existing_run_attempt_id IS NOT NULL AND retry_disposition<>'local_retry'").fetchone()[0] == 2)

    batch = dict(id='b1', branch_id='main', revision_id='r1', chapter_source_version_id='s1',
        expected_actor_ids_json='["actor-1"]', roster_hash=digest, existing_candidate_id='core-candidate-1',
        read_set_id='rs1', idempotency_key=digest, state='proposed')
    reject('reject-chapter-commit-without-authority', 'v3_memory_chapter_batch', {**batch, 'id': 'bad-batch', 'state': 'committed'})
    insert('v3_memory_chapter_batch', batch)
    coverage = dict(batch_id='b1', actor_id='actor-1', observed_name='角色一', appearance='present', status='changed',
        evidence_ids_json='["e1"]', changed_facets_json='["belief"]', unchanged_facets_json='[]',
        unresolved_facets_json='[]', not_applicable_facets_json='[]', reason='正文明确揭示新怀疑')
    reject('reject-changed-coverage-without-delta', 'v3_memory_character_coverage', coverage)
    reject('reject-obsolete-coverage-status', 'v3_memory_character_coverage', {**coverage, 'status': 'unchanged'})
    reject('reject-invalid-appearance', 'v3_memory_character_coverage', {**coverage, 'status': 'reviewed_no_change', 'appearance': 'assumed'})
    statuses = ['changed', 'reviewed_no_change', 'insufficient_evidence', 'mentioned_only', 'unresolved_identity']
    appearances = ['present', 'recollection', 'offscreen_affected', 'mentioned_only', 'unresolved']
    for index, (status, appearance) in enumerate(zip(statuses, appearances)):
        insert('v3_memory_character_coverage', {**coverage, 'actor_id': f'actor-{index + 1}', 'status': status,
            'appearance': appearance, 'delta_artifact_id': 'art1' if status == 'changed' else None,
            'changed_facets_json': '["belief"]' if status == 'changed' else '[]'})
    accept('five-coverage-statuses-and-appearances-persist', db.execute('SELECT count(DISTINCT status),count(DISTINCT appearance) FROM v3_memory_character_coverage').fetchone() == (5, 5))
    db.execute("UPDATE v3_memory_chapter_batch SET state='committed',existing_changeset_id='cs-r1' WHERE id='b1'")
    accept('chapter-commit-preserves-existing-changeset-reference', db.execute("SELECT existing_changeset_id FROM v3_memory_chapter_batch WHERE id='b1'").fetchone()[0] == 'cs-r1')

    event = dict(id='l1', branch_id='main', revision_id='r1', claim_id='c1', kind='state_ended',
        authority_changeset_id='cs-r1', evidence_ids_json='["e1"]')
    reject('reject-state-end-without-story-anchor', 'v3_memory_lifecycle_event', event)
    reject('reject-correction-without-reason', 'v3_memory_lifecycle_event', {**event, 'kind': 'correction_retracted'})
    reject('reject-branch-hide-without-reason', 'v3_memory_lifecycle_event', {**event, 'kind': 'branch_hidden'})
    reject('reject-restore-without-reversed-event', 'v3_memory_lifecycle_event', {**event, 'kind': 'restored'})
    insert('v3_memory_story_anchor', dict(id='a1', timeline_id='story-1', label='交还钥匙', existing_fact_id='core-f2', source_version_id='s1'))
    insert('v3_memory_lifecycle_event', {**event, 'at_story_anchor_id': 'a1',
        'revealed_at_json': '{"chapterId":"chapter-1","chapterOrder":1,"sceneId":"scene-1","sceneOrder":0,"eventOrder":1,"codePointOffset":3}'})
    insert('v3_memory_lifecycle_event', {**event, 'id': 'l2', 'kind': 'correction_retracted', 'reason': '作者修订旧章归属'})
    insert('v3_memory_lifecycle_event', {**event, 'id': 'l3', 'kind': 'branch_hidden', 'reason': '分支不继承此命题'})
    insert('v3_memory_lifecycle_event', {**event, 'id': 'l4', 'kind': 'restored', 'reverses_event_id': 'l3'})
    accept('state-end-correction-hide-restore-remain-distinct', db.execute('SELECT count(DISTINCT kind) FROM v3_memory_lifecycle_event').fetchone()[0] == 4)
    before = db.execute('SELECT count(*) FROM v3_memory_claim_projection').fetchone()[0]
    db.executescript(schema)
    accept('schema-repeat-preserves-populated-projections', db.execute('SELECT count(*) FROM v3_memory_claim_projection').fetchone()[0] == before)
    accept('schema-repeat-preserves-original-authority-table', db.execute('SELECT body FROM existing_authority_probe').fetchall() == [('甲😀𠮷乙',)])
    accept('sqlite-integrity', db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok')
    accept('sqlite-foreign-key-integrity', db.execute('PRAGMA foreign_key_check').fetchall() == [])
    table_count = db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE 'v3_%'").fetchone()[0]
    trigger_count = db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'v3_%'").fetchone()[0]
    db.close()

    typescript = args.typescript.resolve() if args.typescript else args.repository.resolve() / 'node_modules/typescript'
    contracts = sorted((package / 'vnext').glob('*.ts'))
    modules = sorted(package.rglob('*.mjs'))
    command = [args.node, str(typescript / 'bin/tsc'), '--noEmit', '--strict', '--noUncheckedIndexedAccess',
        '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler',
        *[str(path.relative_to(package)) for path in contracts]]
    compiler = subprocess.run(command, cwd=package, capture_output=True, text=True, timeout=60)
    if compiler.returncode:
        raise RuntimeError(compiler.stdout + compiler.stderr)
    javascript = r'''
const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.argv[1]);
const root = process.argv[2];
const files = JSON.parse(process.argv[3]);
const comments = files.map(file => {
  const text = fs.readFileSync(path.join(root,file),'utf8');
  const scanner = ts.createScanner(ts.ScriptTarget.Latest,false,ts.LanguageVariant.Standard,text);
  let count = 0;
  for(let token=scanner.scan();token!==ts.SyntaxKind.EndOfFileToken;token=scanner.scan()) {
    if(token===ts.SyntaxKind.SingleLineCommentTrivia || token===ts.SyntaxKind.MultiLineCommentTrivia) count++;
  }
  if(count) throw new Error(`Comments found in ${file}`);
  return {file,comments:count};
});
const contractPaths = files.filter(file=>file.endsWith('.ts')).map(file=>path.join(root,file));
const program = ts.createProgram(contractPaths,{strict:true,noUncheckedIndexedAccess:true,target:ts.ScriptTarget.ES2022});
const checker = program.getTypeChecker();
const source = program.getSourceFile(path.join(root,'vnext/memory-contracts-v3.ts'));
const aliases = {};
for(const statement of source.statements) {
  if(ts.isTypeAliasDeclaration(statement) && ['ClaimKindV3','CharacterReviewStatusV3','BeliefStanceV3'].includes(statement.name.text)) {
    const type = checker.getTypeAtLocation(statement);
    aliases[statement.name.text] = type.types.map(item=>item.value).sort();
  }
}
const transpiled = ts.transpileModule(source.text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const loaded = {exports:{}};
new Function('module','exports',transpiled)(loaded,loaded.exports);
const memory = loaded.exports;
const unicodeChecks = [];
const equal = (name,value,expected) => {
  if(JSON.stringify(value)!==JSON.stringify(expected)) throw new Error(name);
  unicodeChecks.push({check:name,passed:true});
};
const reject = (name,operation) => {
  try { operation(); } catch { unicodeChecks.push({check:name,passed:true}); return; }
  throw new Error(name);
};
equal('codepoint-to-utf16-astral-span',memory.codePointSpanToUtf16V3('甲😀𠮷乙',1,3),{start:1,end:5});
equal('utf16-to-codepoint-astral-span',memory.utf16SpanToCodePointV3('甲😀𠮷乙',1,5),{start:1,end:3});
reject('reject-middle-of-first-surrogate',()=>memory.utf16SpanToCodePointV3('甲😀𠮷乙',2,5));
reject('reject-middle-of-second-surrogate',()=>memory.utf16SpanToCodePointV3('甲😀𠮷乙',1,4));
reject('reject-codepoint-out-of-bounds',()=>memory.codePointSpanToUtf16V3('甲😀𠮷乙',1,5));
reject('reject-fractional-adapter-offset',()=>memory.codePointSpanToUtf16V3('甲😀𠮷乙',1.5,3));
equal('combining-mark-is-separate-codepoint',memory.codePointSpanToUtf16V3('e\u0301',0,2),{start:0,end:2});
equal('empty-span-roundtrip',memory.utf16SpanToCodePointV3('甲😀𠮷乙',3,3),{start:2,end:2});
console.log(JSON.stringify({comments,unicodeChecks,aliases,typescriptVersion:ts.version}));
'''
    source_check = subprocess.run([args.node, '-e', javascript, str(typescript), str(package),
        json.dumps([str(path.relative_to(package)) for path in contracts + modules])],
        capture_output=True, text=True, timeout=60)
    if source_check.returncode:
        raise RuntimeError(source_check.stdout + source_check.stderr)
    source_result = json.loads(source_check.stdout)
    accept('typescript-and-sql-coverage-enums-match', source_result['aliases']['CharacterReviewStatusV3'] == sorted(statuses))
    accept('typescript-and-sql-proposition-kinds-match', source_result['aliases']['ClaimKindV3'] == sorted(['world', 'belief', 'utterance', 'inference', 'plan']))
    accept('shared-character-belief-stances', source_result['aliases']['BeliefStanceV3'] == sorted(['knows', 'believes', 'suspects', 'rejects', 'uncertain']))
    accept('all-four-typescript-contracts-and-one-module-scanned', len(contracts) == 4 and len(modules) == 1)
    script = Path(__file__).resolve()
    python_comments = sum(token.type == tokenize.COMMENT for token in tokenize.generate_tokens(io.StringIO(script.read_text(encoding='utf-8')).readline))
    accept('verification-script-has-no-comments', python_comments == 0)
    accept('sql-schema-has-no-comments', '--' not in schema and '/*' not in schema)
    paths = contracts + modules + [schema_path, package / 'design/data-contracts-v3.md', script]
    return {
        'scope': 'design-contracts-only-not-integrated-with-client',
        'passed': True,
        'sqliteVersion': sqlite3.sqlite_version,
        'newTableCount': table_count,
        'triggerCount': trigger_count,
        'databaseUnderWorkDir': str(database.relative_to(work)),
        'checks': checks,
        'typescript': {'passed': True, 'version': source_result['typescriptVersion'],
            'options': command[2:command.index(str(contracts[0].relative_to(package)))],
            'files': [str(path.relative_to(package)) for path in contracts], 'diagnostics': compiler.stdout + compiler.stderr},
        'sourceComments': source_result['comments'],
        'unicodeAdapterChecks': source_result['unicodeChecks'],
        'fileHashes': {str(path.relative_to(package)) if path.is_relative_to(package) else path.name:
            hashlib.sha256(path.read_bytes()).hexdigest() for path in paths},
        'notValidated': ['production migration adapters', 'novel quality', 'model extraction fidelity',
            'cross-record semantic scope and branch ancestry', 'story partial-order acyclicity',
            'evidence truth beyond fixtures', 'coverage set completeness and facet semantics',
            'continuous watermark advancement', 'production concurrency and crash recovery']
    }


parser = argparse.ArgumentParser()
parser.add_argument('--package-root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--repository', type=Path, default=Path.cwd())
parser.add_argument('--typescript', type=Path)
parser.add_argument('--node', default=os.environ.get('CODEX_PRIMARY_RUNTIME_NODE') or shutil.which('node') or 'node')
parser.add_argument('--work-dir', type=Path, default=Path.cwd() / 'report_build/contract-checks-v3')
parser.add_argument('--output', type=Path)
arguments = parser.parse_args()
result = run(arguments)
output = arguments.output or arguments.package_root / 'audit/contract-verification-v3.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passed': result['passed'], 'checks': len(result['checks']),
    'unicodeChecks': len(result['unicodeAdapterChecks']), 'tables': result['newTableCount'],
    'triggers': result['triggerCount'], 'output': str(output)}, ensure_ascii=False))
