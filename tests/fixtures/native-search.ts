export const nativeSource = { url: 'https://developers.openai.com/api/docs/guides/tools-web-search', title: 'OpenAI 官方搜索文档' };
export const nativeText = '𠮷：已查阅官方文档。';
export const nativeAnnotation = { type: 'url_citation', ...nativeSource, start_index: 2, end_index: Array.from(nativeText).length };
export const nativeCall = { type: 'web_search_call', id: 'ws-fixture', status: 'completed',
  action: { type: 'search', queries: ['OpenAI web_search official documentation'], sources: [{ type: 'url', ...nativeSource }] } };
export const nativeResponse = { id: 'resp-fixture', status: 'completed',
  output: [
    { id: 'reason-fixture', type: 'reasoning', encrypted_content: 'opaque-reasoning' },
    nativeCall,
    { id: 'msg-fixture', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: nativeText, annotations: [nativeAnnotation] }] }
  ], usage: { input_tokens: 30, output_tokens: 20 } };
