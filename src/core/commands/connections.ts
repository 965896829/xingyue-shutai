import { ApplicationError } from '../../shared/errors';
import { embeddingSettingsSchema } from '../../shared/studio';
import type { Command } from '../../shared/types';
import { nativeServerLimit, usesNativeSearch } from '../../shared/web-search';
import { id, now } from '../domain';
import { CompatibleEmbeddings } from '../embeddings';
import { nativeSearchSources } from '../native-web-search';
import { invokeModel } from '../provider';
import { callExternal, callModel, estimatedUnits } from '../runtime/model-gateway';
import { PublicSearch } from '../search';
import type { Service } from '../service';

export const connectionCommands = new Set<Command>(['profiles.test', 'embedding.test', 'search.test']);
type ConnectionHost = Pick<Service, 'assistant' | 'requestJournal' | 'store' | 'profiles' | 'caller' |
  'managementController' | 'runner' | 'chat' | 'coverController'>;

export async function handleConnectionCommand(host: ConnectionHost, command: Command, a: Record<string, unknown>) {
  if (command === 'embedding.test') {
    const settings = embeddingSettingsSchema.parse(host.assistant.embedding ?? {});
    const journal = host.requestJournal ?? host.store;
    if (!journal) throw new Error('请求账本未初始化');
    const owner = { id: id(), usage: { input: 0, output: 0, cost: 0, currency: settings.currency } };
    const result = await callExternal(journal, owner, 'management-embedding-test', {
      provider: 'embeddings', model: settings.model, version: 1, identity: settings,
      pricing: settings.price, currency: settings.currency
    }, ['连接测试'], settings.price === null ? null : estimatedUnits(32, 0, settings.price, 0), host.managementController.signal,
    () => new CompatibleEmbeddings(settings, host.assistant.embeddingKey ?? '').embed(['连接测试'], host.managementController.signal),
    (result) => ({ input: result.tokens, output: 0, cost: result.tokens === null || settings.price === null ? null : result.tokens * settings.price / 1e6, currency: settings.currency }));
    return { ok: true, dimensions: result.vectors[0].length, tokens: result.tokens };
  }
  if (command === 'search.test') {
    const journal = host.requestJournal ?? host.store;
    if (!journal) throw new Error('请求账本未初始化');
    const profile = host.profiles.find(profile => a.profileId ? profile.id === a.profileId : profile.protocol === 'responses' && profile.enabled);
    if (profile && usesNativeSearch(profile, host.assistant.search)) {
      if (!profile.apiKey) throw new Error('请先为测试模型配置 API Key');
      const owner = { id: id(), usage: { input: 0, output: 0, cost: 0, currency: profile.currency } };
      const query = 'OpenAI 官方 Responses API web_search 文档';
      const result = await callModel(journal, owner, 'management-native-search-test', host.caller ?? invokeModel,
        { ...profile, stream: false, outputLimit: Math.min(profile.outputLimit, 1024) },
        '请执行一次联网搜索，查找 OpenAI 官方 web_search 文档，简短回答并引用来源。',
        [{ role: 'user', content: query }], [], host.managementController.signal, () => {},
        { webSearch: { maxCalls: 1, required: true, serverLimit: nativeServerLimit(profile, host.assistant.search) } });
      const sources = nativeSearchSources(result.webSearch ?? { calls: [], citations: [] });
      if (!result.webSearch?.calls.some(call => call.status === 'completed') || !sources.length)
        throw new Error('模型服务未返回已完成的原生搜索与可核对来源，请检查模型或中转是否支持 web_search');
      return { ok: true, query, at: now(), message: 'OpenAI 原生搜索与来源返回正常', credits: null,
        results: sources.map(source => ({ title: source.title, url: source.url, content: result.text.slice(0, 6000) })) };
    }
    if (host.assistant.search.provider === 'openai') throw new Error('请先配置支持工具调用的 Responses 模型，再测试 OpenAI 原生搜索');
    const result = await new PublicSearch(
      { ...host.assistant.search, enabled: true },
      host.assistant.searchKey,
      true,
      host.managementController.signal,
      { store: journal, owner: { id: id(), usage: { input: 0, output: 0, cost: 0, currency: 'USD' } } }
    ).search('Tavily API documentation');
    return { ok: true, ...result };
  }
  if (command === 'profiles.test') {
    if (host.runner?.controller || host.chat?.controller || host.coverController)
      throw new Error('请等当前模型任务结束再测试连接');
    const profile = host.profiles.find((p) => p.id === a.id);
    if (!profile) throw new Error('模型配置不存在');
    const toolTest = a.tools === true;
    const journal = host.requestJournal ?? host.store;
    if (!journal) throw new Error('请求账本未初始化');
    const owner = { id: id(), usage: { input: 0, output: 0, cost: 0, currency: profile.currency } };
    const tools = toolTest
      ? [
          {
            name: 'probe',
            description: 'Call this tool with value ping',
            parameters: {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
              additionalProperties: false
            }
          }
        ]
      : [];
    const result = await callModel(journal, owner, 'management-profile-test', host.caller ?? invokeModel,
      profile,
      'Protocol connectivity test.',
      [
        {
          role: 'user',
          content: toolTest
            ? 'Call probe with value ping, then after its result reply pong.'
            : '虚构的值班簿记着“星灯已亮”。请只回复这四个汉字。'
        }
      ],
      tools,
      host.managementController.signal
    );
    if (toolTest) {
      const probe = result.calls[0];
      if (result.stop !== 'tools' || result.calls.length !== 1 || probe.name !== 'probe')
        throw new ApplicationError('MODEL_CONFIGURATION', '模型未按要求调用测试工具', [], { capabilityTestFailed: true });
      let value: unknown;
      try { value = JSON.parse(probe.arguments)?.value; } catch { /* Report malformed tool input below. */ }
      if (value !== 'ping') throw new ApplicationError('MODEL_CONFIGURATION', '模型返回的测试工具参数无效', [], { capabilityTestFailed: true });
      const end = await callModel(journal, owner, 'management-profile-tool-test', host.caller ?? invokeModel,
        profile,
        'Protocol connectivity test.',
        [
          { role: 'user', content: 'Call probe then reply pong.' },
          { role: 'assistant', content: result.text, calls: result.calls, native: result.native },
          ...result.calls.map((c) => ({ role: 'tool' as const, callId: c.id, content: 'ping received' }))
        ],
        tools,
        host.managementController.signal
      );
      if (end.stop !== 'complete' || !end.text.trim()) throw new ApplicationError('MODEL_CONFIGURATION', '工具结果续轮未完成', [], { capabilityTestFailed: true });
      return { ok: true, text: end.text };
    }
    if (result.stop !== 'complete' || !result.text.trim()) throw new ApplicationError('MODEL_CONFIGURATION', '模型未返回完整文字，请检查输出和连接设置', [], { capabilityTestFailed: true });
    return { ok: true, text: result.text };
  }
  throw new Error('不支持的连接测试');
}
