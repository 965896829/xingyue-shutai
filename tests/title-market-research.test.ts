import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fanqieTitleSources, titleSearchTopic, titleResearchBrief } from '../src/core/title-market-research';
import { makeBookSpec, makeCreationSpec, tagBundle } from '../src/core/tags';
import { newProject } from '../src/core/domain';
import { emptyTagInput } from '../src/shared/tags';
import { profileSchema, type SecretProfile } from '../src/shared/types';
import { requestBody } from '../src/core/provider';
import { titleSystemPrompt, creationPromptResources, titleEditorialResources } from '../src/core/creation-prompts';
import { expressionPack } from '../src/core/expression-rules';
import { recommendedTitleIds, titleReviewSchema, type TitlePlanning } from '../src/shared/creation';
import type { CreationPlan } from '../src/shared/creation';

const root = path.resolve('resources/skill');
test('实时书名检索只使用公开分类与标签，不外送作者设定、角色和私密备注', () => {
  const input = emptyTagInput();
  input.selection.reading.main = 'reading.main.003';
  input.selection.reading.plot = ['reading.plot.078'];
  input.premise = '内部未公开的主角张某某与家庭地址';
  input.mustKeep = ['私人密码提示'];
  const spec = makeBookSpec(newProject('秘密书名', 'unused', {}), input, 1, tagBundle(root).taxonomy);
  const topic = titleSearchTopic(root, spec, '作者的私人题材描述');
  assert.ok(topic.genre.length > 0);
  assert.match(topic.query, /^site:fanqienovel\.com\/page\//);
  assert.doesNotMatch(JSON.stringify(topic), /张某某|秘密书名|家庭地址|私人/);
});

test('只收官方详情页的真实标题元数据，拒绝聚合页、伪域名、模型空想链接和URL充当标题', () => {
  const sources = fanqieTitleSources([
    { title: '十日终焉完整版在线免费阅读_十日终焉小说_番茄小说官网', url: 'https://fanqienovel.com/page/123?from=search' },
    { title: '重复书页', url: 'https://www.fanqienovel.com/page/123/' },
    { title: '官方第二本 - 番茄小说', url: 'https://fanqienovel.com/page/456' },
    { title: '关键词聚合', url: 'https://fanqienovel.com/keyword/123' },
    { title: '伪装站点', url: 'https://fanqienovel.com.evil.test/page/123' },
    { title: '账户字段', url: 'https://user:password@fanqienovel.com/page/789' },
    { title: '非官方协议', url: 'http://fanqienovel.com/page/789' },
    { title: 'https://fanqienovel.com/page/789', url: 'https://fanqienovel.com/page/789' },
    { title: '', url: 'https://fanqienovel.com/page/999' }
  ]);
  assert.deepEqual(sources, [{ title: '十日终焉', url: 'https://fanqienovel.com/page/123' },
    { title: '官方第二本', url: 'https://fanqienovel.com/page/456' }]);
});

test('创意开书没有选标签时从已确认题材与正向方案提取公开词，不把否定的系统重生当成卖点', () => {
  const input = emptyTagInput();
  input.premise = '尚未公开的创意';
  const spec = makeCreationSpec(newProject('私密书名', 'unused', {}), input, 1, tagBundle(root).taxonomy);
  const plan = { statements: [{ kind: 'fusion_causality', text: '东方玄幻提供宗门利益；时间穿越影响当前处境。不另设现代人身份、系统或重生经历。' }] } as CreationPlan;
  const topic = titleSearchTopic(root, spec, '脑洞玄幻', plan);
  assert.equal(topic.genre, '玄幻脑洞');
  assert.deepEqual(topic.tags, ['时间穿越', '宗门']);
  assert.match(topic.query, /玄幻脑洞 时间穿越 宗门/);
  assert.doesNotMatch(JSON.stringify(topic), /私密书名|重生|系统/);
  const editorial = titleSearchTopic(root, spec, '脑洞玄幻', plan, true);
  assert.equal(editorial.query, 'site:fanqienovel.com/page/ 玄幻 时间 回到过去 小说');
  assert.equal(editorial.alternativeQuery, 'site:fanqienovel.com/page/ 玄幻 宗门 小说');
  assert.doesNotMatch(JSON.stringify(editorial), /私密书名|重生|系统/);
});

test('研究说明保留表达方法与尾部不匹配提醒；无可靠来源不把研究文本充当证据', () => {
  const sources = [{ title: '样本', url: 'https://fanqienovel.com/page/123' }];
  const brief = '以口吻制造反差。\n此书是异界穿越，不支持时间往返。';
  assert.equal(titleResearchBrief(brief, sources), brief);
  assert.equal(titleResearchBrief(brief, []), undefined);
  assert.equal(titleResearchBrief(' \u0000 ', sources), undefined);
  const long = '先保留已核对书名。' + '中间说明'.repeat(3000) + '\n匹配边界：不能借用系统设定。';
  const result = titleResearchBrief(long, sources)!;
  assert.ok(Array.from(result).length <= 6000);
  assert.ok(result.startsWith('先保留已核对书名。'));
  assert.ok(result.endsWith('匹配边界：不能借用系统设定。'));
});

test('书名专用表达上下文保留语言规则和作者设置，不带全量正文审稿规则', () => {
  const project = newProject('上下文验收', 'unused', {});
  const title = expressionPack(root, project.config, 'title');
  const review = expressionPack(root, project.config, 'review');
  assert.deepEqual(title.binding!.modules, ['IMG', 'LEX', 'SYN', 'VOICE']);
  assert.equal(title.binding!.ruleIds.length, 48);
  assert.ok(title.prompt.length < review.prompt.length / 2);
  project.config.expressionRules.modules = ['URBAN'];
  assert.ok(expressionPack(root, project.config, 'title').binding!.modules.includes('URBAN'));
  const editorial = titleEditorialResources(root);
  const prompt = titleSystemPrompt({ controller: '', resources: creationPromptResources(root),
    editorial, naming: { editorialVersion: 1, marketResearchVersion: 1, candidateCount: 6 } as TitlePlanning,
    reviewing: false, submitTool: 'submit_title_candidates', expression: title.prompt });
  assert.match(prompt, /styleBrief/);
  assert.match(prompt, /符合设定只是底线/);
  assert.match(prompt, /不能靠机械禁词/);
  assert.match(editorial.reviewer, /审美弱项是编辑建议，保留可选，不为此增加修复轮/);
});

test('新策略显式传达平台目标与样本应用方式，作者偏好优先且审核可给空推荐', () => {
  const project = newProject('命名目标', 'unused', {});
  const expression = expressionPack(root, project.config, 'title_market');
  const editorial = titleEditorialResources(root, 2);
  const naming = { editorialVersion: 2, marketResearchVersion: 1, candidateCount: 6, rule: 'local' } as TitlePlanning;
  const build = (reviewing: boolean) => titleSystemPrompt({ controller: '', resources: creationPromptResources(root),
    editorial, naming, reviewing, submitTool: reviewing ? 'submit_title_review' : 'submit_title_candidates', expression: expression.prompt });
  assert.match(build(false), /默认按番茄该题材的商业书名定位/);
  assert.match(build(false), /没有填写要求不推定偏好短名/);
  assert.match(build(false), /信息密度.*阅读回报/);
  assert.match(build(false), /rule只限制长度与保存字符，不代表命名风格/);
  assert.doesNotMatch(build(false), /按短题面适用/);
  assert.match(build(true), /recommendedIds由本轮独立复核/);
  assert.match(build(true), /空数组，不新增审核轮/);
  assert.deepEqual(expression.binding!.modules, ['IMG', 'LEX', 'SYN', 'VOICE']);
  assert.equal(expression.binding!.ruleIds.length, 48, '保留规则及适用例外，不删除规则库');
});

test('推荐列表只采用新版当前复核，兼容旧数据且不推荐未知或事实冲突候选', () => {
  const base = { editorialVersion: 2, phase: 'ready', batch: {
    candidates: [{ id: 'supported' }, { id: 'conflict' }], recommendedIds: ['conflict']
  }, review: { hash: 'a'.repeat(64), result: { decisions: [
    { candidateId: 'supported', verdict: 'keep', reason: '符合本书题材' },
    { candidateId: 'conflict', verdict: 'revise', reason: '新增不存在的系统' }
  ], recommendedIds: ['conflict', 'unknown', 'supported'] } } } as TitlePlanning;
  assert.deepEqual(recommendedTitleIds(base), ['supported']);
  assert.deepEqual(recommendedTitleIds({ ...base, phase: 'reviewing' }), [], '审查未完成时不提前亮推荐');
  const noRecommendation = structuredClone(base); noRecommendation.review!.result.recommendedIds = [];
  assert.deepEqual(recommendedTitleIds(noRecommendation), []);
  delete noRecommendation.review!.result.recommendedIds;
  assert.deepEqual(recommendedTitleIds(noRecommendation), [], '新版缺少复核推荐时不退回生成器推荐');
  assert.deepEqual(recommendedTitleIds({ ...base, editorialVersion: 1 }), ['conflict'], '旧任务保留原显示规则');
  assert.doesNotThrow(() => titleReviewSchema.parse({ decisions: base.review!.result.decisions }));
});

test('番茄原生搜索使用实时访问与域名过滤，不改变其他对话的搜索参数', () => {
  const p: SecretProfile = { ...profileSchema.parse({ id: 'test', name: 'test', protocol: 'responses', model: 'fixture', baseUrl: 'https://example.test/v1' }), apiKey: 'fixture' };
  const options = { webSearch: { maxCalls: 2, required: true, serverLimit: false, allowedDomains: ['fanqienovel.com'] } };
  const body = requestBody(p, '资料检索', [{ role: 'user', content: '悬疑脑洞' }], [], options).body;
  assert.equal(body.tool_choice, 'required');
  assert.deepEqual(body.tools, [{ type: 'web_search', search_context_size: 'medium', external_web_access: true, filters: { allowed_domains: ['fanqienovel.com'] } }]);
  assert.ok(body.include.includes('web_search_call.action.sources'));
  assert.equal(body.max_tool_calls, undefined);
  const old = requestBody(p, '', [], [], { webSearch: { maxCalls: 1 } }).body;
  assert.equal(old.tools[0].filters, undefined);
});

test('实时样本用于自然表达与多样角度，不新增结构、审核轮或冒充榜单和查重', () => {
  const t = { marketResearchVersion: 1, phase: 'generating', candidateCount: 6 } as TitlePlanning;
  const prompt = titleSystemPrompt({ controller: '', resources: creationPromptResources(root), naming: t,
    reviewing: false, submitTool: 'submit_title_candidates', expression: '' });
  assert.match(prompt, /不同读者群|读者群/);
  assert.match(prompt, /不新增审核轮/);
  assert.match(prompt, /不是关键词禁用表/);
  assert.match(prompt, /不能代表全站趋势/);
  assert.match(prompt, /不要求模型重新联网/);
  assert.match(prompt, /本批恰好6个候选/);
});
