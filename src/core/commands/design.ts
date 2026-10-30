import type { Service } from '../service';
import { designInputSchema } from '../../shared/design';
import { emptyTagInput } from '../../shared/tags';
import { designCatalog, designSpec, bindDesign } from '../design-operations';
import { id, hash, prosePath } from '../domain';
import { makeCreationSpec, tagBundle, tagHash, planningFingerprint } from '../tags';
import { approvedCreation } from '../../shared/creation';
import { titleSource } from '../title-naming';
import { handleCreationCommand } from './creation';
import { compatibleRunBase } from '../runtime-settings';
import { bookProfilePath, readBookProfile } from '../publishing';
import { publishingOptions } from '../../shared/publishing';
import { collectMarketEvidence, marketCacheKey } from '../market-evidence';
import type { MarketEvidence, MarketRequest } from '../../shared/market-evidence';

export async function runDesign(
  host: Service,
  raw: unknown,
  profileId: string | undefined,
  idle: () => void
) {
  idle();
  const input = designInputSchema.parse(raw),
    spec = designSpec(input.id),
    { s, p } = host.require();
  const title = designCatalog(host.skillRoot).find((e) => e.id === input.id)!.title;
  if (input.id === 'market-evidence.research') {
    const { profile, catalog } = readBookProfile(s);
    if (!profile.publishing || !catalog) throw new Error('请先在题材与发布分类中选择番茄频道和主分类');
    const main = publishingOptions(profile, catalog).find(o => o.group === 'reading.main')!;
    const run = host.makeRun('analysis', input.request || title, profileId);
    bindDesign(s, host.skillRoot, run, { ...input, sources: [...new Set([...input.sources, bookProfilePath])] });
    const request: MarketRequest = { catalogId: catalog.id, channel: main.channel, categoryId: main.platformId, rankType: 'reading' };
    const key = `title-market:${marketCacheKey(request)}`;
    const evidence = await collectMarketEvidence(request, catalog, host.managementController.signal, { cached: s.db.get<MarketEvidence>(key), enabled: host.assistant.search.enabled });
    if (host.store !== s || !compatibleRunBase(s, run)) throw new Error('作品版本已改变，请重新读取公开资料');
    if (['ready', 'partial'].includes(evidence.status) && evidence.samples.some(sample => sample.title)) s.db.set(key, evidence);
    s.db.set(`market-evidence:${run.id}`, evidence);
    const content = `# ${main.label}公开样本\n\n${evidence.reason}\n\n- 观察时间：${evidence.observedAt}\n- 统计截止：${evidence.board?.statsCutoffRaw ?? '未知'}\n- 公开榜单：${evidence.board?.url ?? '无'}\n\n${evidence.samples.map(sample => `- [${sample.title ?? '书名未核验'}](${sample.url})：第${sample.rankPosition}名，在读${sample.readCount?.value ?? '未知'}，首次发布时间未知。`).join('\n')}\n\n${evidence.limitations.join('\n\n')}\n`;
    run.changes = [{ path: run.design!.targets[0].path, baseHash: run.design!.targets[0].hash, content }];
    run.responseText = '公开样本已整理，可查看来源和时间后保存。'; s.db.saveRun(run); host.emit({ type: 'snapshot' });
    return run.id;
  }
  if (spec.adapter === 'planning') {
    if (input.id === 'concept-forge.create') {
      if (!s.db.get('tagDraft')) {
        const value = { ...emptyTagInput(), premise: String(s.db.get('premise') ?? input.request) };
        s.db.set('tagDraft', makeCreationSpec(p, value, 1, tagBundle(host.skillRoot).taxonomy));
      }
      const run = host.makeRun('revision', input.request || title, profileId);
      host.initializePlanning(run, approvedCreation(p) ? 'revision' : 'adoption', true);
      return host.launch(run);
    }
    const source = input.runId
      ? s.db.run(input.runId)
      : s.db.runs().find((r) => r.planning && compatibleRunBase(s, r));
    if (!source?.planning || !compatibleRunBase(s, source)) throw new Error('请选择当前版本的策划任务');
    if (input.id === 'concept-forge.regenerate')
      return handleCreationCommand(
        host,
        'tags.reroll',
        {
          id: source.id,
          reportHash: source.planning.reportHash,
          keepDirectionIds: input.directionId ? [input.directionId] : [],
          instruction: input.request
        },
        idle
      );
    if (input.id === 'story-contract.build') {
      if (!input.directionId) throw new Error('请选择需要展开的故事方向');
      return handleCreationCommand(
        host,
        'tags.selectDirection',
        {
          id: source.id,
          reportHash: source.planning.reportHash,
          directionId: input.directionId,
          acceptAssumptions: false,
          resolutions: {}
        },
        idle
      );
    }
    if (!source.planning.candidate) throw new Error('请先生成完整作品方案');
    const run = host.makeRun('revision', input.request || title, profileId);
    run.planning = structuredClone(source.planning);
    run.planning.origin = 'revision';
    run.planning.phase = 'reviewing_contract';
    run.planning.contractReview = undefined;
    run.planning.planApproval = undefined;
    run.planning.repair = undefined;
    run.planning.binding = planningFingerprint(run);
    run.changes = structuredClone(source.changes);
    run.facts = structuredClone(source.facts);
    return host.launch(run);
  }
  if (spec.adapter === 'title') {
    const source = titleSource(s, input.runId);
    return handleCreationCommand(
      host,
      'titles.start',
      {
        sourceRunId: input.runId,
        planHash: tagHash(source.plan),
        requestId: id(),
        profileId,
        instruction: input.request
      },
      idle
    );
  }
  if (spec.adapter === 'revision-core') {
    const source = input.runId ? s.db.run(input.runId) : undefined;
    if (source && (source.accepted || !compatibleRunBase(s, source)))
      throw new Error('正文候选已改变，请重新选择');
    const run = host.makeRun('revision', input.request || title, profileId),
      chapter = input.chapter ?? p.chapter;
    run.changes = source
      ? structuredClone(source.changes)
      : [
          {
            path: prosePath(chapter),
            content: s.readAccepted(prosePath(chapter)).content,
            baseHash: s.db.document(prosePath(chapter))?.hash ?? null
          }
        ];
    const prose = run.changes.filter((c) => /^07_正文章节\/第\d+章\.md$/.test(c.path));
    if (!prose.length || prose.some((c) => !c.content.trim() || c.content.includes('待填写')))
      throw new Error('请选择已有完整正文的章节');
    const chapters = prose.map((c) => Number(c.path.match(/第(\d+)章/)![1])).sort((a, b) => a - b);
    run.revisionCore = {
      version: 1,
      sourceRunId: source?.id ?? run.id,
      chapters,
      proseHashes: Object.fromEntries(
        prose.map((c) => [Number(c.path.match(/第(\d+)章/)![1]), hash(c.content)])
      ),
      coverage: {},
      reports: {},
      phase: 'extract'
    };
    run.continuity = { mode: 'retcon', fromChapter: chapters[0] };
    return host.launch(run);
  }
  const run = host.makeRun('revision', input.request || title, profileId);
  bindDesign(s, host.skillRoot, run, input);
  return host.launch(run);
}
