import type { Change, Issue, StageId } from '../shared/types';
import { paths } from './domain';

function tableDocument(file: string) {
  if (file === paths.outline) return {
    title: '章节总纲',
    columns: ['章节', '类型', '强度', '承接上章', '前300字入口', '核心场面', '主角动作', '外部推动', '状态变化', '设定揭示', '阅读回报', '人物记忆变化', '章末牵引'],
    row: /^\d{3,}$/
  };
  const rhythm = file.match(/^05_长篇大纲\/第(\d+)[-—](\d+)章节奏\.md$/);
  if (rhythm) return {
    title: `第${rhythm[1]}-${rhythm[2]}章节奏`,
    columns: ['章节单元', '类型与强度曲线', '当前目标/压力', '主角行动', '外部推动', '阅读回报', '余波/状态变化', '信息推进', '章末牵引'],
    row: /^\d{3,}—\d{3,}$/
  };
}

/** Fill only the deterministic document title of a recognizable complete table.
 * This runs after append assembly. No cells, headings or free-form text are inferred.
 */
function missingTableTitle(file: string, lines: string[]) {
  const spec = tableDocument(file);
  if (!spec) return;
  let fence = '';
  for (const line of lines) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; continue; }
    if (!fence && /^ {0,3}#\s/.test(line)) return;
  }
  const first = lines.findIndex(line => line.trim());
  const cells = (line = '') => /^\|.*\|\s*$/.test(line) ? line.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim()) : [];
  const header = cells(lines[first]), separator = cells(lines[first + 1]);
  if (header.length !== spec.columns.length || header.some((cell, i) => cell !== spec.columns[i]) ||
      separator.length !== header.length || separator.some(cell => !/^:?-{3,}:?$/.test(cell))) return;
  let count = 0;
  for (let i = first + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const row = cells(lines[i]);
    if (row.length !== header.length || !spec.row.test(row[0]) || row.some(cell => !cell)) return;
    count++;
  }
  return count ? spec.title : undefined;
}

/** Story detail belongs in the original template, rather than parallel reports. */
export function authorOutputContract(stage: StageId, mode: string) {
  if (mode === 'prose') return '';
  const common = '作者文件严格沿用本阶段原Skill模板的一级标题、标题层级、字段顺序和表格列序。采用原Skill的紧凑规划粒度：普通字段用一个具体短句回答自身问题，确有独立条件才补第二句；复杂因果按需展开。规划写已选定的故事事实、人物行动、信息依据、条件、代价和结果，不写给写作者的反复叮嘱、假想错误和自我论证。同一规则在权威字段完整写一次，其他字段只写本处新增作用；同一行动在核心场面展开，其他字段提炼其独有变化。限制和禁止提前揭示集中在原有对应字段，不在每个场面重复“不能把人物写成……”“不等于……”等说明。禁止附加来源清单、保护清单、交付声明、复核报告或重复总结。机器哈希、候选状态与核验过程只留工具字段和宿主记录。简洁以删除重复和错层展开实现，不删原字段、人物选择、必要条件和因果，也不截断、降推理强度或省略质量检查。';
  const stages: Partial<Record<StageId, string>> = {
    S01: '只输出原模板十二字段。读者承诺分别落实在一句话卖点、第一章核心事件和长线连载动力中，不另建读者承诺小节。风险与修正可用字段内列表或紧凑表格；不要重新抄录作者全文。',
    S02: '项目配置保留一级标题及原十六字段，文风文件保留一级标题和原模板五个二级标题及对应字段。数值与选择直接给值，用户硬约束集中一处保留必要数字、顺序及禁区；默认假设只写本轮补足，不再复述硬约束。未启用样本按项目默认简洁填写，不虚构分析。客户端设置由宿主维护。',
    S03: '严格使用原八个栏目作为二级标题。底层规则用一张编号表集中写独有触发、结果、责任和必要例外，其他七栏只补对应优势、限制、成本等独有信息。不要每条规则扩成多级说明书，也不重复初始设定和结局全貌。',
    S04: '九份文件分别使用原角色卡、关系、行为、批次摘要及五类台账结构。尚无正文的日志/摘要只保留结构和一句尚未发生说明，不提前逐角色预演30章。角色卡十九字段完整；未来计划仅写对应计划字段。',
    S05: '保留一级标题。容量表采用七列原模板：卷数为“第一卷”，章节范围为“001—180”，预计章数为“180章”。全书主线、成长线和对抗路线在容量表前各用一个短字段概括；之后只有各卷十三字段，不加卷前摘要、首批事件组或终局复盘。每卷交代目标、关键选择/代价、转折、高潮和余波；远卷停在关键节点，不展开多场分镜或大段制度论证。八卷规划通常约4000—7000字符即可承载，独有因果确需更多则保留，此为编辑参考而非验收字数。',
    S06: '先写“# 章节总纲”，再写原十三列表格，每章一行；首列为纯补零数字“001”，不放章名或第/章字样。每格默认一个紧凑短句，只写该列独有信息；核心场面概述事件链，场面分镜留给S08。每行通常约180—300字符，必要独有因果可超出，不按字数触发重写。保留完整当前批次和既有已采纳批次。',
    S07: '先写与当前文件范围一致的原模板一级标题（如“# 第001-030章节奏”），再写原九列表格，每行3—5章单元；首列为纯范围“001—005”，主题如有需要放入当前目标/压力列。类型与强度列保留各章曲线，其余列各用一个单元层面的短句，点出关键章号和变化/释放位置，不逐列重讲五章情节；只有真实同构例外才在表后短述。30章节奏通常约1500—2500字符，独有条件可超出，不按字数返工。',
    S08: '保留一级标题，先一次写完原批次字段，再逐章十二字段。核心场面字段概述本章最重要事件；在十二字段之后另列“### 场面推进”，按序写可执行的连续行动，每场用一至三句交代人物、地点、信息依据、行动选择、代价和结果，复杂行动按需增加；其余字段提炼各自结论，不再复述场面或整段规则。每章通常约450—750字符可写清，特殊复杂章据实际增加，不删场或删条件凑字数。与 Codex 原产物一样将连续场面置于该章“场面推进”三级标题，十二字段仍齐全；不增加来源、禁令或完成声明。章标题规范为“## 第001章：标题”。',
    S09: '保留两个文件的一级标题。任务清单保留原字段，逐项提炼当前章任务；单章细纲保留原公共字段与场面二级标题。每场交代地点、人物、动作顺序、信息依据、选择及结果；在场面内按需使用当前关切、个人意义、主观判断、注意线索、可用经验、对话意图、叙述处理及声音依据等可选字段，不另加问卷或来源报告。已在公共揭示预算中明确的禁区不在每场复述，场面只补本处边界。必要动作与因果保留，不机械按字数重写。',
    S11: '章后报告严格只有本章结果、人物更新、下一章交接、同步检查四个二级标题；人物更新按人分三级标题。来源引文只提交结构化事实证据，不另抄一张来源表。人物事实可按需要标 characterLayer 为 stable（长期倾向）、current（当下状态）或 experience（已发生经历），未知不补造；一次情绪不更新稳定人格。有明确依据时可选用 subjectiveResponse 记录 trigger（触发）、interpretation（人物理解）、emotionOrIntent（情绪或意图）、actionEffect（对行动影响），这些是显式创作资料，不是隐藏推理，允许为空。同步状态只在同步检查字段写待提交，不在各台账和每段正文重复声明。'
  };
  const specific = mode === 'review'
    ? '质量评分严格使用原十六字段，分数后附简短具体理由；修改意见只写实际问题的位置、影响和最小修复，无需修复则一句说明，不再逐项复述已经通过的检查。中文报告必须独立可读：必要时直接给出定位短句，不写引号或转义格式说明，不写“见下方核验引文”等指向隐藏内容的文字。五项准确原文证据及具体判断仍完整保留在wenxu-review核验块，不另写五节重复点评或证据附表。'
    : stages[mode === 'memory' ? 'S11' : stage] ?? '';
  return `## 原Skill输出结构\n${common}\n${specific}`;
}

/** Only managed automatic outputs are checked; unknown prose or author edits are never deleted. */
export function authorStructureIssues(change: Change): Issue[] {
  const file = change.path;
  let allowed: ((title: string) => boolean) | undefined;
  const exact = (...names: string[]) => (title: string) => names.includes(title);
  if ([paths.seed, paths.config, paths.outline, paths.relations, paths.timeline, paths.hooks, paths.terms, paths.knowledge].includes(file as any) || /任务清单\.md$|质量评分\.md$/.test(file)) allowed = () => false;
  else if (file === paths.style) allowed = exact('核心风格', '分场景规则', '必须保留', '禁止机械继承', '与商业节奏的合并规则');
  else if (file === paths.world) allowed = exact('世界底层规则', '主角金手指', '金手指限制', '使用代价', '信息差', '敌人反制方式', '体系升级空间', '中后期防重复机制');
  else if (file === paths.volumes) allowed = title => title === '分卷容量表' || /^第[一二三四五六七八九十百\dX]+卷(?:[：:]|$)/.test(title);
  else if (file === paths.items) allowed = exact('物品', '伤势');
  else if (/第\d+[-—]\d+章节奏\.md$/.test(file)) allowed = exact('节奏检查');
  else if (/第\d+[-—]\d+章细纲\.md$/.test(file)) allowed = title => /^第\d+章(?:[：:]|$)/.test(title);
  else if (/第\d+章细纲\.md$/.test(file)) allowed = title => /^场面\s*\d+[：:]/.test(title);
  else if (/第\d+章记忆更新\.md$/.test(file)) allowed = exact('本章结果', '人物更新', '下一章交接', '同步检查');
  if (!allowed) return [];
  const issues: Issue[] = [];
  let fence = '';
  let documentTitles = 0;
  for (const [index, line] of change.content.split(/\r?\n/).entries()) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; continue; }
    if (fence) continue;
    if (/^ {0,3}#\s+\S/.test(line)) documentTitles++;
    const heading = line.match(/^ {0,3}##\s+(.+?)\s*#*$/)?.[1].replace(/\*\*/g, '').trim();
    if (heading && !allowed(heading) && !['客户端设置', '客户端管理参数', '可追溯事实记录'].includes(heading))
      issues.push({ code: 'template_extra_section', severity: 'error', path: file, line: index + 1,
        message: `模板外小节“${heading}”：把独有的有效内容并入原模板对应字段，删除重复说明；不要删除实质因果或重写已合格的其他文件。` });
  }
  if (tableDocument(file) && documentTitles !== 1)
    issues.push({ code: 'template_document_title', severity: 'error', path: file,
      message: `原模板要求一个文件一级标题，当前为${documentTitles}个；仅修正标题，保留完整表格及全部叙事内容。` });
  return issues;
}

/** A generated ledger has a single original table per section. Repair only an
 * isolated body-row continuation, never a new table, prose, or fenced sample. */
function normalizeLedgerTableGaps(change: Change): { change: Change; edits: string[] } {
  const headers: Record<string, string[][]> = {
    [paths.relations]: [['角色A', '角色B', '关系标签', '极性', '信任度0-100', '冲突点', '当前状态', '未来变化方向']],
    [paths.timeline]: [['时间锚点', '章节', '地点', '已发生事件', '后续期限或影响']],
    [paths.hooks]: [['编号', '首次出现', '表面线索', '当前证据', '谁知道', '计划回收', '状态']],
    [paths.terms]: [['术语', '白话定义', '触发条件', '直接后果', '代价或限制', '首次说明', '仍未知']],
    [paths.knowledge]: [['角色', '亲眼确认', '被告知', '当前推测或误解', '不知道的关键事实', '最近更新']],
    [paths.items]: [['名称', '持有人或位置', '当前状态', '来源章节', '连续性限制'], ['角色', '伤势', '严重度', '当前限制', '治疗与恢复依据', '最近更新']]
  };
  const known = headers[change.path], edits: string[] = [];
  if (!known) return { change, edits };
  const lines = change.content.split(/\r?\n/), out: string[] = [];
  const cells = (line = '') => /^\|.*\|\s*$/.test(line) ? line.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim()) : [];
  const separator = (line: string | undefined, count: number) => {
    const row = cells(line); return row.length === count && row.every(cell => /^:?-{3,}:?$/.test(cell));
  };
  let fence = '', columns = 0, pendingBlank = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; columns = 0; }
    if (fence || marker) { out.push(line); pendingBlank = false; continue; }
    const row = cells(line);
    if (known.some(header => row.length === header.length && row.every((cell, j) => cell === header[j])) && separator(lines[i + 1], row.length)) {
      columns = row.length; pendingBlank = false;
    } else if (columns && !line.trim() && !pendingBlank) {
      pendingBlank = true;
    } else if (columns && pendingBlank && row.length === columns && row.every(Boolean) && !separator(line, columns) && !separator(lines[i + 1], columns)) {
      out.pop(); edits.push('连续台账表格行'); pendingBlank = false;
    } else if (!columns || row.length !== columns || pendingBlank) {
      columns = 0; pendingBlank = false;
    }
    out.push(line);
  }
  return { change: edits.length ? { ...change, content: out.join(change.content.includes('\r\n') ? '\r\n' : '\n') } : change, edits };
}

/** Equivalent notation only. All narrative cells, numeric values and extra themes survive. */
export function normalizeSkillNotation(change: Change): { change: Change; edits: string[] } {
  const file = change.path, edits: string[] = [];
  const outline = file === paths.outline, volumes = file === paths.volumes, rhythm = /^05_.*第\d+[-—]\d+章节奏\.md$/.test(file);
  const batch = /^06_.*第\d+[-—]\d+章细纲\.md$/.test(file);
  if (!outline && !volumes && !rhythm && !batch) return normalizeLedgerTableGaps(change);
  let fence = '';
  const lines = change.content.split(/\r?\n/).map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; return line; }
    if (fence) return line;
    if (batch) {
      const header = line.match(/^##\s+第(\d+)章(?:\s*[：:]\s*(.*))?\s*$/);
      if (!header) return line;
      const value = `## 第${header[1].padStart(3, '0')}章${header[2] ? `：${header[2]}` : ''}`;
      if (value !== line) edits.push('批次章标题');
      return value;
    }
    if (!/^\|.*\|\s*$/.test(line)) return line;
    const cells = line.split(/(?<!\\)\|/), first = cells[1]?.trim();
    const range = (s: string) => s.match(/^(?:第)?(\d+)\s*章?\s*[-—～~至]\s*(?:第)?(\d+)\s*章?(?:[：:]\s*(.+))?$/);
    if (outline && cells.length === 15) {
      const chapter = first?.match(/^(?:第)?(\d+)章?$/);
      if (chapter) cells[1] = ` ${chapter[1].padStart(3, '0')} `;
    } else if (rhythm && cells.length === 11) {
      const found = range(first);
      if (found) {
        cells[1] = ` ${found[1].padStart(3, '0')}—${found[2].padStart(3, '0')} `;
        if (found[3]) cells[3] = ` ${found[3]}；${cells[3].trim()} `;
      }
    } else if (volumes && cells.length === 9) {
      const volume = first?.match(/^(?:第)?([一二三四五六七八九十百\d]+)卷?$/), found = range(cells[3]?.trim());
      const count = cells[4]?.trim().match(/^(\d+)\s*章?$/);
      if (volume && found && !found[3] && count) {
        cells[1] = ` 第${volume[1]}卷 `;
        cells[3] = ` ${found[1].padStart(3, '0')}—${found[2].padStart(3, '0')} `;
        cells[4] = ` ${count[1]}章 `;
      }
    }
    const value = cells.join('|');
    if (value !== line) edits.push('表格章号或容量表示法');
    return value;
  });
  const title = missingTableTitle(file, lines);
  if (title) { lines.unshift(`# ${title}`, ''); edits.push('原模板文件一级标题'); }
  return { change: edits.length ? { ...change, content: lines.join(change.content.includes('\r\n') ? '\r\n' : '\n') } : change, edits };
}
