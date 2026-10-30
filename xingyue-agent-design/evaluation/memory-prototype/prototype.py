import argparse
import hashlib
import json
import math
import os
import platform
import random
import resource
import sqlite3
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path


def digest(value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def connect(path):
    db = sqlite3.connect(path)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=NORMAL')
    db.executescript('''
        CREATE TABLE corpus(chapter INTEGER PRIMARY KEY, source_hash TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE source_versions(branch TEXT NOT NULL, path TEXT NOT NULL, source_hash TEXT NOT NULL, recorded_from INTEGER NOT NULL, recorded_to INTEGER, PRIMARY KEY(branch,path,source_hash,recorded_from));
        CREATE INDEX source_scope ON source_versions(branch,path,recorded_from,recorded_to,source_hash);
        CREATE TABLE facts(id TEXT PRIMARY KEY, branch TEXT NOT NULL, entity_id TEXT NOT NULL, valid_from INTEGER NOT NULL, valid_to INTEGER, recorded_from INTEGER NOT NULL, recorded_to INTEGER, source_path TEXT NOT NULL, source_hash TEXT NOT NULL, kind TEXT NOT NULL, viewer TEXT, review_status TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE INDEX fact_scope ON facts(branch,entity_id,review_status,valid_from,valid_to,recorded_from);
        CREATE INDEX fact_source ON facts(branch,source_path,source_hash);
        CREATE TABLE commits(id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, chapter INTEGER NOT NULL, source_hash TEXT NOT NULL);
        CREATE TABLE character_coverage(commit_id TEXT NOT NULL, entity_id TEXT NOT NULL, dimensions TEXT NOT NULL, PRIMARY KEY(commit_id,entity_id));
    ''')
    return db


def assertion(key, branch, entity, chapter, source_path, source_hash, value, valid_to=None, edition=1, kind='state', viewer=None, field='condition'):
    return {'id': key, 'branch': branch, 'entity_id': entity, 'valid_from': chapter, 'valid_to': valid_to, 'recorded_from': edition, 'recorded_to': None, 'source_path': source_path, 'source_hash': source_hash, 'kind': kind, 'viewer': viewer, 'review_status': 'accepted', 'field': field, 'value': value}


def insert_fact(db, value):
    columns = ['id', 'branch', 'entity_id', 'valid_from', 'valid_to', 'recorded_from', 'recorded_to', 'source_path', 'source_hash', 'kind', 'viewer', 'review_status']
    db.execute('INSERT INTO facts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', [value[key] for key in columns] + [json.dumps(value, ensure_ascii=False, sort_keys=True)])


def add_source(db, branch, path, source_hash, edition=1, end=None):
    db.execute('INSERT INTO source_versions VALUES(?,?,?,?,?)', (branch, path, source_hash, edition, end))


def source_map(db, branch, edition):
    return dict(db.execute('SELECT path,source_hash FROM source_versions WHERE branch=? AND recorded_from<=? AND (recorded_to IS NULL OR recorded_to>?)', (branch, edition, edition)))


def legacy_query(db, branch, chapter, edition, entities, sources=None):
    sources = source_map(db, branch, edition) if sources is None else sources
    selected = set(entities)
    found = []
    for (payload,) in db.execute('SELECT payload FROM facts').fetchall():
        value = json.loads(payload)
        if value['branch'] != branch or value['entity_id'] not in selected or value['review_status'] != 'accepted':
            continue
        if value['valid_from'] > chapter or value['valid_to'] is not None and value['valid_to'] <= chapter:
            continue
        if value['recorded_from'] > edition or value['recorded_to'] is not None and value['recorded_to'] <= edition:
            continue
        if sources.get(value['source_path']) != value['source_hash']:
            continue
        found.append(value)
    return sorted(found, key=lambda item: item['id'])


def query_sql(entities):
    placeholders = ','.join('?' for _ in entities)
    return f'''SELECT f.payload FROM facts f JOIN source_versions s
        ON s.branch=f.branch AND s.path=f.source_path AND s.source_hash=f.source_hash
        WHERE f.branch=? AND f.entity_id IN ({placeholders}) AND f.review_status='accepted'
        AND f.valid_from<=? AND (f.valid_to IS NULL OR f.valid_to>?)
        AND f.recorded_from<=? AND (f.recorded_to IS NULL OR f.recorded_to>?)
        AND s.recorded_from<=? AND (s.recorded_to IS NULL OR s.recorded_to>?)
        ORDER BY f.id'''


def query_parameters(branch, chapter, edition, entities):
    return [branch, *entities, chapter, chapter, edition, edition, edition, edition]


def indexed_query(db, branch, chapter, edition, entities):
    rows = db.execute(query_sql(entities), query_parameters(branch, chapter, edition, entities)).fetchall()
    return [json.loads(row[0]) for row in rows]


def character_packet(db, branch, chapter, edition, character):
    facts = indexed_query(db, branch, chapter, edition, [character])
    return [{'id': f['id'], 'field': f['field'], 'value': f['value'], 'kind': f['kind'], 'source_hash': f['source_hash']} for f in facts if f['viewer'] == character]


def seed_corpus(db):
    filler = '雨停后街道仍有积水。有人搬来木箱，同伴核对账目，又把没有确认的线索放到另一边。'
    points = 0
    facts = 0
    with db:
        for chapter in range(1, 401):
            entries = []
            sentences = []
            for offset in range(30):
                entity = f'c{(chapter * 7 + offset * 11) % 80:03d}'
                value = f'保留第{chapter}次来往中第{offset + 1}项约定，等待相关人物作出回应'
                sentences.append(f'人物{entity}记下：{value}。')
                entries.append((offset, entity, value))
            base = ''.join(sentences)
            body = (base + filler * math.ceil((2500 - len(base)) / len(filler)))[:2500]
            assert len(body) == 2500
            version = digest(body)
            path = f'chapter/{chapter:04d}'
            db.execute('INSERT INTO corpus VALUES(?,?,?)', (chapter, version, body))
            for branch in ['main', 'alternative']:
                add_source(db, branch, path, version)
            points += len(body)
            for offset, entity, value in entries:
                key = f'f{chapter:04d}_{offset:02d}'
                branch = 'alternative' if (chapter * 30 + offset) % 20 == 0 else 'main'
                kind = 'belief' if offset % 7 == 0 else 'state'
                end = None if offset % 10 == 0 else chapter + 20
                record = assertion(key, branch, entity, chapter, path, version, value, valid_to=end, kind=kind, viewer=entity, field=f'concern_{offset}')
                record['evidence_quote'] = sentences[offset]
                insert_fact(db, record)
                facts += 1
    db.execute('ANALYZE')
    return {'chapters': 400, 'codepoints_per_chapter': 2500, 'body_codepoints': points, 'assertions': facts, 'entities': 80, 'main_assertions': db.execute("SELECT COUNT(*) FROM facts WHERE branch='main'").fetchone()[0], 'alternative_assertions': db.execute("SELECT COUNT(*) FROM facts WHERE branch='alternative'").fetchone()[0], 'token_count': None, 'token_count_note': '本原型未调用tokenizer，中文码点数量不是模型token数量。'}


def submit_chapter(db, key, chapter, source_hash, expected, coverage, deltas):
    allowed = {'updated', 'no_change', 'no_evidence', 'not_applicable'}
    roster = [item['entity_id'] for item in coverage]
    if len(roster) != len(set(roster)) or set(roster) != set(expected):
        raise ValueError('角色覆盖不完整或重复')
    dimensions = {item['entity_id']: item['dimensions'] for item in coverage}
    for item in coverage:
        if set(item['dimensions']) != {'emotion', 'motivation', 'belief'} or not set(item['dimensions'].values()) <= allowed:
            raise ValueError('心智维度覆盖无效')
    for delta in deltas:
        if dimensions.get(delta['entity_id'], {}).get(delta['field']) != 'updated':
            raise ValueError('未获更新状态的维度不能写入新心理状态')
    for entity, fields in dimensions.items():
        for field, status in fields.items():
            if status == 'updated' and not any(d['entity_id'] == entity and d['field'] == field for d in deltas):
                raise ValueError('声明已更新但缺少增量')
    payload_hash = digest({'chapter': chapter, 'source_hash': source_hash, 'expected': expected, 'coverage': coverage, 'deltas': deltas})
    with db:
        previous = db.execute('SELECT payload_hash FROM commits WHERE id=?', (key,)).fetchone()
        if previous:
            if previous[0] != payload_hash:
                raise ValueError('同一幂等键对应不同载荷')
            return 'reused'
        db.execute('INSERT INTO commits VALUES(?,?,?,?)', (key, payload_hash, chapter, source_hash))
        for item in coverage:
            db.execute('INSERT INTO character_coverage VALUES(?,?,?)', (key, item['entity_id'], json.dumps(item['dimensions'], ensure_ascii=False)))
        for delta in deltas:
            insert_fact(db, delta)
    return 'committed'


def expect_error(action):
    try:
        action()
    except ValueError:
        return True
    raise AssertionError('应拒绝的操作被允许')


def functional_checks():
    db = connect(':memory:')
    results = []
    with db:
        for chapter in [1, 2, 5, 6, 7]:
            add_source(db, 'main', f'chapter/{chapter}', f'h{chapter}')
        add_source(db, 'alternative', 'chapter/1', 'alt1')
        insert_fact(db, assertion('injury-old', 'main', 'A', 1, 'chapter/1', 'h1', '右臂骨折', valid_to=5, viewer='A'))
        insert_fact(db, assertion('injury-healed', 'main', 'A', 5, 'chapter/5', 'h5', '右臂已愈合', viewer='A'))
        insert_fact(db, assertion('belief-wrong', 'main', 'A', 2, 'chapter/2', 'h2', '甲是凶手', valid_to=6, kind='belief', viewer='A', field='belief'))
        insert_fact(db, assertion('truth', 'main', 'A', 2, 'chapter/2', 'h2', '乙是凶手', kind='objective', viewer=None, field='culprit'))
        insert_fact(db, assertion('belief-corrected', 'main', 'A', 6, 'chapter/6', 'h6', '乙是凶手', kind='belief', viewer='A', field='belief'))
        insert_fact(db, assertion('branch-alt', 'alternative', 'A', 1, 'chapter/1', 'alt1', '右臂完好', viewer='A'))
        insert_fact(db, assertion('motivation-A', 'main', 'A', 1, 'chapter/1', 'h1', '查清旧案并保住失物招领处', viewer='A', field='motivation'))
        insert_fact(db, assertion('motivation-B', 'main', 'B', 1, 'chapter/1', 'h1', '攒钱开自己的修理铺', viewer='B', field='motivation'))
    early = indexed_query(db, 'main', 3, 1, ['A'])
    late = indexed_query(db, 'main', 7, 1, ['A'])
    assert 'injury-old' in {f['id'] for f in early} and 'injury-healed' not in {f['id'] for f in early}
    assert 'injury-healed' in {f['id'] for f in late} and 'injury-old' not in {f['id'] for f in late}
    results.append({'check': 'current_edition_as_of_chapter', 'passed': True})
    alternate = indexed_query(db, 'alternative', 3, 1, ['A'])
    assert [f['id'] for f in alternate] == ['branch-alt']
    assert 'branch-alt' not in {f['id'] for f in early}
    results.append({'check': 'branch_isolation', 'passed': True})
    mind_before = character_packet(db, 'main', 3, 1, 'A')
    mind_after = character_packet(db, 'main', 7, 1, 'A')
    assert '甲是凶手' in json.dumps(mind_before, ensure_ascii=False)
    assert '乙是凶手' not in json.dumps(mind_before, ensure_ascii=False)
    assert '乙是凶手' in json.dumps(mind_after, ensure_ascii=False)
    assert all(f['id'] != 'truth' for f in mind_before + mind_after)
    results.append({'check': 'belief_proposition_without_unknown_truth', 'passed': True, 'before': mind_before, 'after': mind_after})
    with db:
        db.execute("UPDATE source_versions SET recorded_to=2 WHERE branch='main' AND path='chapter/1'")
        add_source(db, 'main', 'chapter/1', 'h1-revised', 2)
    assert 'injury-old' not in {f['id'] for f in indexed_query(db, 'main', 3, 2, ['A'])}
    assert 'injury-old' in {f['id'] for f in indexed_query(db, 'main', 3, 1, ['A'])}
    with db:
        insert_fact(db, assertion('injury-revised', 'main', 'A', 1, 'chapter/1', 'h1-revised', '右臂挫伤', valid_to=5, edition=2, viewer='A'))
    assert 'injury-revised' in {f['id'] for f in indexed_query(db, 'main', 3, 2, ['A'])}
    results.append({'check': 'source_revision_invalidation_and_historical_edition', 'passed': True})
    coverage = [
        {'entity_id': 'A', 'dimensions': {'emotion': 'updated', 'motivation': 'no_change', 'belief': 'no_change'}},
        {'entity_id': 'B', 'dimensions': {'emotion': 'no_evidence', 'motivation': 'no_change', 'belief': 'no_evidence'}}
    ]
    delta = assertion('emotion-7-A', 'main', 'A', 7, 'chapter/7', 'h7', '暂时松了一口气', viewer='A', field='emotion')
    action = lambda: submit_chapter(db, 'chapter-7-update', 7, 'h7', ['A', 'B'], coverage, [delta])
    assert action() == 'committed'
    assert action() == 'reused'
    assert db.execute("SELECT COUNT(*) FROM facts WHERE id='emotion-7-A'").fetchone()[0] == 1
    assert db.execute('SELECT COUNT(*) FROM character_coverage').fetchone()[0] == 2
    changed = dict(delta, value='十分愤怒')
    assert expect_error(lambda: submit_chapter(db, 'chapter-7-update', 7, 'h7', ['A', 'B'], coverage, [changed]))
    results.append({'check': 'idempotent_commit_and_payload_conflict', 'passed': True})
    assert expect_error(lambda: submit_chapter(db, 'incomplete', 7, 'h7', ['A', 'B'], coverage[:1], [delta]))
    forbidden = assertion('invented-emotion-B', 'main', 'B', 7, 'chapter/7', 'h7', '非常开心', viewer='B', field='emotion')
    assert expect_error(lambda: submit_chapter(db, 'invented', 7, 'h7', ['A', 'B'], coverage, [delta, forbidden]))
    b_packet = character_packet(db, 'main', 7, 1, 'B')
    assert any(item['field'] == 'motivation' and item['value'] == '攒钱开自己的修理铺' for item in b_packet)
    assert not any(item['field'] == 'emotion' for item in b_packet)
    results.append({'check': 'character_coverage_no_change_no_evidence', 'passed': True, 'coverage': coverage})
    for branch in ['main', 'alternative']:
        for chapter in [1, 3, 5, 7]:
            for edition in [1, 2]:
                assert legacy_query(db, branch, chapter, edition, ['A', 'B']) == indexed_query(db, branch, chapter, edition, ['A', 'B'])
    results.append({'check': 'functional_query_semantics_equivalence', 'passed': True, 'queries': 16})
    db.close()
    return results


def quantiles(values):
    ordered = sorted(values)
    return {'samples': len(values), 'median_ms': statistics.median(values), 'p95_ms': ordered[math.ceil(len(values) * .95) - 1], 'min_ms': ordered[0], 'max_ms': ordered[-1]}


def run(destination, count):
    destination.mkdir(parents=True, exist_ok=True)
    database = destination / 'synthetic-million.sqlite'
    if database.exists():
        raise RuntimeError('输出数据库已存在，请使用新的 --output 目录')
    db = connect(database)
    started = time.perf_counter()
    corpus = seed_corpus(db)
    seed_ms = (time.perf_counter() - started) * 1000
    rng = random.Random(20261028)
    cases = []
    for i in range(count):
        branch = 'alternative' if i % 8 == 0 else 'main'
        chapter = rng.randint(30, 400)
        entities = [f'c{n:03d}' for n in rng.sample(range(80), 4)]
        cases.append((branch, chapter, 1, entities))
    maps = {(branch, 1): source_map(db, branch, 1) for branch in ['main', 'alternative']}
    for case in cases[:5]:
        assert legacy_query(db, *case, maps[(case[0], case[2])]) == indexed_query(db, *case)
    legacy_times, indexed_times, counts = [], [], []
    for index, case in enumerate(cases):
        calls = [('legacy', lambda: legacy_query(db, *case, maps[(case[0], case[2])])), ('indexed', lambda: indexed_query(db, *case))]
        if index % 2:
            calls.reverse()
        outputs = {}
        for name, action in calls:
            started = time.perf_counter_ns()
            outputs[name] = action()
            elapsed = (time.perf_counter_ns() - started) / 1e6
            (legacy_times if name == 'legacy' else indexed_times).append(elapsed)
        assert outputs['legacy'] == outputs['indexed']
        counts.append(len(outputs['indexed']))
    plan = db.execute('EXPLAIN QUERY PLAN ' + query_sql(cases[0][3]), query_parameters(*cases[0])).fetchall()
    db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    checks = functional_checks()
    result = {
        'prototype': 'V3 memory scoped-query feasibility',
        'at_utc': datetime.now(timezone.utc).isoformat(),
        'scope': '合成 SQLite 可行性原型，不是当前客户端端到端压测。',
        'environment': {'python': platform.python_version(), 'sqlite': sqlite3.sqlite_version, 'platform': platform.platform(), 'machine': platform.machine(), 'logical_cpus_reported': os.cpu_count(), 'pid': os.getpid(), 'peak_rss_kib_linux': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, 'cache_condition': '同一进程先生成语料并预热5次，计时为暖缓存；交替执行顺序。'},
        'dataset': corpus,
        'seed_ms': seed_ms,
        'database_bytes': database.stat().st_size,
        'queries': {'seed': 20261028, 'count': count, 'characters_per_query': 4, 'chapter_min': 30, 'chapter_max': 400, 'branches': ['main', 'alternative'], 'scope': '同一编辑版本下，截至指定章号有效且来源版本匹配的实体事实；正文不参与计时查询。', 'minimum_result_count': min(counts), 'maximum_result_count': max(counts), 'equality_passed': count},
        'timing': {'full_json_scan': quantiles(legacy_times), 'composite_index_query': quantiles(indexed_times), 'median_ratio': statistics.median(legacy_times) / statistics.median(indexed_times)},
        'query_plan': [list(row) for row in plan],
        'functional_checks': checks,
        'passed': all(item['passed'] for item in checks),
        'not_measured': ['真实客户端端到端耗时', '模型调用与记忆提取质量', 'embedding、向量索引、FTS与语义召回', '原文文件I/O与引文位置校验', '真实百万字小说的长期人物与因果一致性', '冷启动、冷缓存、多用户并发', '当前JavaScript实现与Python实现的跨语言性能比较'],
        'interpretation': '两个路径使用相同合成数据和相同查询语义。全扫路径反序列化所有12000条JSON再筛选；索引路径先按分支、角色、有效章节与版本筛选再反序列化。结果只能证明此数据与机器上的局部查询方案可行，不能外推为客户端提速比例。'
    }
    (destination / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': result['passed'], 'body_codepoints': corpus['body_codepoints'], 'assertions': corpus['assertions'], 'timing': result['timing'], 'functional_checks': len(checks), 'results': str(destination / 'results.json')}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--queries', type=int, default=120)
    arguments = parser.parse_args()
    if arguments.queries < 100:
        raise ValueError('至少100个查询样本用于p95统计')
    run(arguments.output, arguments.queries)
