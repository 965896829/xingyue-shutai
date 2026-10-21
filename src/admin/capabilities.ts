// Original page keys remain stable, including pages awaiting a platform service.
export const connectedPages = new Set([
  'dashboard', 'platform-overview', 'platforms', 'models', 'providers', 'base-models',
  'skills', 'desktop-skills', 'agents', 'memory', 'workflows', 'rules', 'structured-content',
  'knowledge', 'projects', 'templates', 'expenses', 'chat-audits', 'realtime-load',
  'runtime-policies', 'pricing', 'calculator', 'desktop-devices',
  'storage', 'backups', 'logs', 'audit',
  'local-workspace', 'local-creation', 'local-cover', 'local-settings', 'local-trash', 'local-search'
]);
export const unavailableMessage = '尚未接入：当前本机客户端没有此平台服务。页面与配置项保留供查看，不能保存或执行。';
