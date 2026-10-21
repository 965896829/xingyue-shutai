import { Component, useState, type ReactNode } from 'react';
import type { PageSpec } from './reference/lib/api';
import { connectedPages, unavailableMessage } from './capabilities';
import { ReferenceRecordForm } from './reference/components/reference-record-form';
import { CompactHeading } from './reference/components/reference-ui';

export function Availability({ page, force = false }: { page: PageSpec; force?: boolean }) {
  if (!force && connectedPages.has(page.key)) return null;
  return <div className="local-unavailable" role="note"><span>尚未接入</span><p>原后台页面已保留。此模块需要平台服务，当前本机客户端尚未提供；配置不会保存，也不会执行业务操作。</p></div>;
}
export function PreviewFallback({ page }: { page: PageSpec }) {
  const [form, setForm] = useState(false);
  return <div className="ref-page"><CompactHeading title={page.label} description={page.description} /><section className="ref-box"><p>{unavailableMessage}</p>{page.fields.length > 0 && <button className="button secondary" onClick={() => setForm(true)}>查看原配置表单</button>}</section>{form && <ReferenceRecordForm page={page} onClose={() => setForm(false)} onDone={() => {}} />}</div>;
}
export class PageBoundary extends Component<{ page: PageSpec; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('管理页面渲染失败', this.props.page.key, error.message); }
  render() { return this.state.failed ? <PreviewFallback page={this.props.page} /> : this.props.children; }
}
