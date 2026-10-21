// Empty envelopes keep the original platform screens inspectable. These are not
// client business records; Availability labels every consuming platform page.
import structured from './reference/lib/structured-preview.json';
export function referencePreview(route: string): unknown | undefined {
  if (route === '/admin/structured/releases') return { active_id: 'preview', items: [{ id: 'preview', name: '原平台内置结构（只读预览）', status: 'preview', version: 0, config: structured, validated: false }] };
  if (route === '/admin/rules' || route === '/admin/rules/prompts') return { release: { id: '尚未接入', digest: '' }, items: [], modules: [], total: 0, page: 1, page_size: 15 };
  if (route === '/admin/agents/settings') return { agent_id: null, version: 0 };
  if (route === '/admin/engines') return {
    preview: true, engines: ['故事方案', '本书设定与规划', '故事记录', '人物行动', '参考内容', '正文与修改', '文字表达', '本章与全书检查', '写作偏好'].map((name, i) => ({ key: `E0${i + 1}`, name, runs: '—', credits: '—', states: {} })),
    defaults: null, version: 0, can_configure: false, isolation: { runtime_role_enabled: false, tables: [] }
  };
  if (route === '/admin/engines/scheduling') return { limits: { max_model_calls: '—', max_author_workflows: '—', interactive_slots: '—' }, model_calls: null, lanes: {} };
  if (route === '/admin/model-discounts') return { version: 0, organization: '', organizations: [], models: [], default_discount: 1, overrides: {} };
  if (route === '/admin/desktop-workbench-store/items') return { items: [], categories: [] };
  if (route === '/admin/quality-governance') return { suites: [], results: [] };
  if (route === '/creation/options') return { models: [], roles: [], stages: [] };
  if (route === '/admin/system/roles') return { items: ['operator', 'admin', 'superadmin'].map(role => ({ role, pages: [], default_pages: [], immutable: role === 'superadmin' })) };
  if (['/admin/engines/projects', '/evaluations', '/evaluations/cases', '/evaluations/reviewers', '/admin/rules/releases', '/admin/system/backups', '/projects', '/admin/projects', '/admin/runs', '/admin/users', '/admin/structured/projects'].includes(route)) return { items: [], total: 0, page: 1, page_size: 20 };
  return undefined;
}
