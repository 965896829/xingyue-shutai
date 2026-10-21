import { createRoot } from 'react-dom/client';
import { AdminApp } from './AdminApp';
import { connectManagement, installManagementBridge } from './transport';
import { configureReferenceApi } from './reference-api';
import './reference/styles/globals.css';
import './reference/styles/reference-admin.css';
import './reference/styles/interactive-controls.css';
import './reference/styles/consumption-heatmap.css';
import './reference/styles/color-mode.css';
import './admin.css';

const root = createRoot(document.getElementById('root')!);
document.documentElement.dataset.colorMode = localStorage.getItem('novel-color-mode') === 'light' ? 'light' : 'dark';
// A browser may reuse an existing tab for a newly copied pairing link.
window.addEventListener('hashchange', () => {
  if (new URLSearchParams(location.hash.slice(1)).has('pair')) location.reload();
});
const pair = new URLSearchParams(location.hash.slice(1)).get('pair');
if (pair) history.replaceState(null, '', location.pathname);
root.render(
  <div className="admin-login">
    <img src="/brand/app-icon.png" alt="" />
    <h1>正在连接星月书台</h1>
    <p>读取本机客户端状态…</p>
  </div>
);
void connectManagement(pair ?? undefined)
  .then((session) => {
    const transport = installManagementBridge(session);
    configureReferenceApi(session, transport);
    root.render(<AdminApp session={session} transport={transport} />);
  })
  .catch((error) =>
    root.render(
      <div className="admin-login">
        <img src="/brand/app-icon.png" alt="" />
        <h1>星月书台 · 管理后台</h1>
        <p>{(error as Error).message}</p>
        <ol>
          <li>打开本机星月书台客户端。</li>
          <li>点击左侧底部「网页管理后台」。</li>
          <li>在自动打开的浏览器中管理客户端。</li>
        </ol>
        <button onClick={() => location.reload()}>重新检查连接</button>
      </div>
    )
  );
