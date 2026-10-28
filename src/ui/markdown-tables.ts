export interface TableColumnContent {
  heading: string;
  values: string[];
}

const identityHeading = /^(?:章(?:节|号|次)?|卷(?:数|次|号)?|序号|编号|ID)$/i;
const compactHeading = /^(?:强度|评分|字数|次数|数量|优先级|状态)$/;

// Approximate displayed width, not byte count: Chinese needs roughly twice the
// space of Latin text at the same font size. This only chooses a reading width.
function textWidth(text: string) {
  return Math.max(0, ...text.slice(0, 2000).split(/\r?\n/).map(line =>
    Array.from(line.trim()).reduce((width, char) => width + (/[^\u0000-\u00ff]/.test(char) ? 14 : 7), 0)));
}

export function tableColumnLayout(columns: TableColumnContent[]) {
  const widths = columns.map(({ heading, values }) => {
    const label = heading.replace(/\s+/g, '');
    const contentWidth = Math.max(textWidth(heading), ...values.map(textWidth));
    // Even an index column can contain a range or a note. Do not force it to
    // stay narrow if the actual content needs more room.
    if ((identityHeading.test(label) || compactHeading.test(label)) && contentWidth <= 84)
      return Math.max(72, contentWidth + 40);
    if (contentWidth > 180) return Math.min(280, Math.max(224, textWidth(heading) + 40));
    return Math.max(112, Math.min(224, contentWidth + 40));
  });
  return { widths, stickyFirst: !!columns.length && identityHeading.test(columns[0].heading.replace(/\s+/g, '')) && widths[0] <= 144 };
}
