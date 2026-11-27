import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { tsImport } from 'tsx/esm/api';

export async function seedBook(directory, audit = false) {
  const { Service } = await tsImport('../src/core/service.ts', import.meta.url);
  const service = new Service(path.resolve('resources/skill'), () => {});
  const parent = path.join(directory, 'books'), title = '专注模式验收';
  await mkdir(parent);
  try {
    await service.invoke('project.create', { parent, title, premise: '一张隔夜的车票', quickWriting: true });
    const store = service.store;
    for (const name of ['标签创作契约', '创作与发布', '书名与入口承诺']) {
      const file = '02_项目配置/' + name + '.md';
      if (!store.db.document(file)) await writeFile(path.join(store.root, file), '# ' + name + '\n\n末班车的约定。', { flag: 'wx' });
    }
    await writeFile(path.join(store.root, '00_作者输入/站台笔记.md'), '# 站台笔记\n\n十点钟发车。');
    if (audit) {
      const { mutateQuality } = await tsImport('../src/core/quality.ts', import.meta.url);
      let revision = 0;
      for (let index = 1; index <= 101; index++) revision = mutateQuality(service.store, revision, {
        kind: 'experiment', experiment: { title: '车票' + index, kind: 'voice_fixed_story', stage: 'holdout',
          family: '车票', sceneFunction: '对话', audience: '悬疑读者', variedFactors: ['voice'], constraints: '保留事件', questions: ['想接着读哪一篇？'] },
        candidates: [{ text: '他收起车票。', runId: '' }, { text: '她把车票递了过来。', runId: '' }]
      }).revision;
      const { LabStore } = await tsImport('../src/core/story-lab/store.ts', import.meta.url);
      const lab = new LabStore(path.join(directory, 'story-lab'));
      try {
        const sessionId = crypto.randomUUID(), at = new Date().toISOString();
        lab.save('sessions', { id: sessionId, title: '旧车票试写', requirements: { idea: '旧车票试写' },
          currentVersionId: null, currentProseId: null, profileId: 'offline', outputLimit: 1024, createdAt: at, updatedAt: at, pins: [], revision: 0 });
        for (const content of ['他把旧车票夹进书里。', '她把车票递给检票员。']) lab.save('versions', {
          id: crypto.randomUUID(), sessionId, content, title: content, kind: 'prose', source: 'edit',
          baseVersionId: null, requestId: null, partial: false, createdAt: at });
      } finally { lab.journal.close(); }
    }
    await writeFile(path.join(directory, 'settings.json'), JSON.stringify({
      profiles: [], recent: [{ root: service.store.root, title }]
    }));
  } finally { await service.drain(); }
}

export async function verifyLabTransfer(evaluate) {
  const verified = await evaluate(`(async () => {
    const buttons = () => [...document.querySelectorAll('.story-lab button')];
    const wait = async fn => {
      const deadline = Date.now() + 10000;
      while (!fn()) { if (Date.now() > deadline) throw Error('未能完成实验室历史版本转入 ' + fn); await new Promise(r => setTimeout(r, 35)); }
      return fn();
    };
    const invoke = async (name, input) => {
      const response = await window.wenxu.invoke(name, input);
      if (!response.ok) throw Error(response.error.message);
      return response.result;
    };
    (await wait(() => document.querySelector('[aria-controls="lab-sessions"]'))).click();
    (await wait(() => buttons().find(b => b.textContent.includes('旧车票试写')))).click();
    (await wait(() => document.querySelector('.lab-related > summary'))).click();
    (await wait(() => buttons().find(b => b.textContent.includes('方案与试稿 ·')))).click();
    const select = await wait(() => document.querySelector('[aria-label="方案与试稿历史"]'));
    const old = [...select.options].find(o => o.textContent.includes('他把旧车票夹进书里'));
    if (!old) throw Error('缺少试稿初版');
    select.value = old.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const transfer = await wait(() => buttons().find(b => b.checkVisibility() && b.textContent.includes('转入当前作品的自由草稿')));
    transfer.click();
    await wait(() => document.querySelector('.lab-notice')?.textContent.includes('已转入'));
    const drafts = await invoke('draft.list', {});
    if (drafts.length !== 1) throw Error('转入草稿数量不符');
    return (await invoke('draft.read', { id: drafts[0].id })).content;
  })()`);
  assert.equal(verified, '他把旧车票夹进书里。');
}

export async function verify(evaluate, send, directory) {
  const entry = 'button[title^="专注写作模式"]';
  const bar = '[role="toolbar"][aria-label="专注写作工具条"]';
  const exit = bar + ' button:last-child';
  const body = '.desk-manuscript .cm-content', inspector = '.editor-panel .cm-content';
  const dialog = '.quality-workbench[role="dialog"]';
  const q = selector => 'document.querySelector(' + JSON.stringify(selector) + ')';
  const visible = selector => 'Boolean(' + q(selector) + '?.checkVisibility())';

  async function waitFor(condition) {
    const deadline = Date.now() + 10000;
    while (!await evaluate(condition)) {
      assert.ok(Date.now() < deadline, condition);
      await delay(40);
    }
  }
  async function center(selector) {
    await waitFor(visible(selector));
    return evaluate('(() => { const el = ' + q(selector) + '; const r = el.getBoundingClientRect();' +
      'const x = r.x + r.width / 2, y = r.y + r.height / 2; return { x, y, hit: el.contains(document.elementFromPoint(x,y)) }; })()');
  }
  async function click(selector) {
    const { x, y, hit } = await center(selector);
    assert.ok(hit, '鼠标点击被其他控件拦截 ' + selector);
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  async function key(name, code, keyCode, modifiers = 0) {
    for (const type of ['keyDown', 'keyUp'])
      await send('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: keyCode, modifiers });
  }

  await click('.recent-book-row button');
  await waitFor(visible(body));
  const fileButton = name => '.files button[title$="' + (name.includes('/') ? '' : '/') + name + '.md"]';
  const fileHeader = name => '.editor-panel header b[title$="/' + name + '.md"]';
  async function clickFile(name) {
    const selector = fileButton(name);
    await waitFor(visible(selector));
    await evaluate(q(selector) + '.scrollIntoView({block:"center"})');
    await click(selector);
  }
  for (const [page, file] of [
    ['自由创作实验室', '原始设定'], ['记忆与连续性', '项目配置'], ['封面设计', '时间线']
  ]) {
    await click('.sidebar nav button[aria-label="' + page + '"]');
    await clickFile(file);
    await waitFor(visible(fileHeader(file)));
    await waitFor(visible(inspector));
    assert.ok(await evaluate(q(fileButton(file)) + '.classList.contains("selected")'));
    if (file === '原始设定') await waitFor(q(inspector) + '.textContent.includes("一张隔夜的车票")');
  }
  for (const file of ['设定拆解', '标签创作契约', '创作与发布', '书名与入口承诺', '文风样本与规则', '世界规则与卖点', '伏笔台账', '规则术语表', '物品与伤势', '站台笔记']) {
    await clickFile(file);
    await waitFor(visible(fileHeader(file)));
    await waitFor(visible(inspector + '[aria-label="' + file + '.md"]'));
  }
  assert.ok(await evaluate(q(inspector) + '.textContent.includes("十点钟发车")'));
  assert.equal(await evaluate(q(inspector) + '.isContentEditable'), false);
  for (const tab of ['共创画布', '作品方案与书名', '创作任务', '创作讨论']) {
    const target = '[...document.querySelectorAll(".work-tabs > button")].find(b => b.textContent.includes(' + JSON.stringify(tab) + '))';
    await evaluate(target + '.click()');
    await waitFor(target + '.getAttribute("aria-current") === "page"');
    await clickFile('世界规则与卖点');
    await waitFor(visible(fileHeader('世界规则与卖点')));
    await clickFile('站台笔记');
    await waitFor(visible(fileHeader('站台笔记')));
  }
  const activeView = q('.work-tabs [aria-current="page"]') + '?.textContent';
  await click('[aria-label="关闭编辑面板"]');
  await click('.work-tabs > button:first-child');
  await waitFor(activeView + ' === "共创画布"');
  assert.equal(await evaluate(q('.panel-toggle') + '.getAttribute("aria-pressed")'), 'false');
  await click('.panel-toggle');
  await waitFor(visible(fileHeader('站台笔记')));
  await click('.inline-warning button');
  await waitFor(activeView + ' === "创作任务"');
  await waitFor(visible('.writing-desk > .work-area'));
  await click('button[aria-label="任务详情"]');
  const historySelect = '[aria-label="选择历史任务"]';
  await waitFor(visible(historySelect));
  const created = await evaluate("window.wenxu.invoke('app.snapshot', {}).then(r => r.result.runs.find(run => run.changes.some(c => c.path.endsWith('/站台笔记.md')))?.id)");
  assert.ok(created);
  assert.equal(await evaluate(q(historySelect) + '.value'), created);
  await click('.work-tabs > button:nth-child(2)');
  await click('.desk-topic-toggle');
  await evaluate('[...document.querySelectorAll(".topic-footer button")].find(b => b.textContent === "历史任务与阶段执行").click()');
  await waitFor(visible(historySelect));
  assert.equal(await evaluate(q(historySelect) + '.value'), created);
  await click('.work-tabs > button:nth-child(2)');
  await evaluate(q(fileButton('项目配置')) + '.click();' + q(fileButton('原始设定')) + '.click()');
  await waitFor(visible(fileHeader('原始设定')));
  await waitFor(q(inspector) + '.textContent.includes("一张隔夜的车票")');
  await evaluate(q(inspector) + '.focus()');
  await send('Input.insertText', { text: '保留这张车票' });
  await waitFor(q(inspector) + '.textContent.includes("保留这张车票")');
  await clickFile('07_正文章节/第001章');
  await click('.app-dialog[open] footer button[type="button"]');
  assert.ok(await evaluate(visible(fileHeader('原始设定'))));
  await clickFile('07_正文章节/第001章');
  await click('.app-dialog[open] footer button[type="submit"]');
  await waitFor(visible(body));
  await clickFile('原始设定');
  await waitFor(q(inspector) + '?.textContent.includes("保留这张车票")');
  await clickFile('07_正文章节/第001章');
  await click('.app-dialog[open] footer button[type="submit"]');
  await waitFor(visible(body));
  await send('Emulation.setDeviceMetricsOverride', { width: 1120, height: 760, deviceScaleFactor: 1, mobile: false });
  await click('.work-tab-tools button[aria-haspopup="dialog"]');
  await waitFor(visible(dialog));
  if (directory) {
    const download = path.join(directory, 'downloads');
    await mkdir(download);
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download });
    const button = label => `[...document.querySelectorAll('.quality-workbench button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && b.checkVisibility())`;
    await waitFor('Boolean(' + button('对比试读') + ')');
    await evaluate(button('对比试读') + '.click()');
    await waitFor('Boolean(' + q('.quality-actions select option[value="1"]') + ')');
    await evaluate(button('导出全部试读') + '.click()');
    const deadline = Date.now() + 15000;
    let data;
    while (!data && Date.now() < deadline) {
      data = await readFile(path.join(download, '星月书台-全部匿名试读.zip')).catch(() => undefined);
      if (!data) await delay(50);
    }
    assert.ok(data, '101 项试读导出未生成压缩包');
    const { unzipSync, strFromU8 } = await import('fflate');
    const pages = unzipSync(data);
    assert.deepEqual(Object.keys(pages), ['试读-1-100.html', '试读-101-101.html']);
    for (const bytes of Object.values(pages)) assert.match(strFromU8(bytes), /她把车票递了过来/);
  }
  await key('F', 'KeyF', 70, process.platform === 'darwin' ? 12 : 10);
  assert.ok(await evaluate(visible(dialog)), '专注快捷键隐藏了当前弹窗');
  assert.ok(!await evaluate(visible(bar)));
  await key('Escape', 'Escape', 27);
  await waitFor('!' + visible(dialog));

  await click(entry);
  await waitFor(visible(bar));
  assert.ok((await center('[aria-label="打开作品文件夹"]')).hit);
  await click('.panel-toggle');
  await waitFor(visible(inspector));
  await click(bar + ' button[title^="切换正文字号"]');
  await click(bar + ' button[title^="切换衬线"]');
  const matchesPrefs = selector => 'getComputedStyle(' + q(selector) + ').fontSize === "17px" && ' +
    'getComputedStyle(' + q(selector) + ').fontFamily.includes("Songti SC")';
  await waitFor(matchesPrefs(inspector));
  await click('[aria-label="关闭编辑面板"]');
  await waitFor(visible(body));
  await waitFor(matchesPrefs(body));
  await click('[aria-label="展开 AI 对话"]');
  await waitFor(visible('.writing-desk > .work-area'));
  assert.ok(!await evaluate(visible(bar)));

  await click(entry);
  await waitFor(visible(exit));
  await evaluate(q(exit) + '.focus()');
  for (const modifiers of [0, 8]) {
    for (let i = 0; i < 12; i++) {
      await key('Tab', 'Tab', 9, modifiers);
      assert.ok(!await evaluate('Boolean(document.activeElement.closest(".sidebar"))'), 'Tab 进入了隐藏侧栏');
    }
  }
  await click(exit);
  await waitFor('document.activeElement === ' + q(entry));
}
