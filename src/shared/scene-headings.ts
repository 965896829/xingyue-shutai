import { numeral, parseChapterNumber } from './chapter-range';

const heading = new RegExp('^#{2,6}[ \\t]+((?:场面|场景|场次)(?=[ \\t：:—-]|' + numeral + '|$)[ \\t]*((' + numeral + ')?[^\\r\\n]*))$');

export function outlineScenes(content: string) {
  const scenes: { title: string; label: string; number: number; start: number; block: string }[] = [];
  let fence = '';
  for (const line of content.matchAll(/[^\r\n]+/g)) {
    const marker = line[0].match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1].startsWith(fence) && !line[0].slice(marker[0].length).trim()) fence = '';
      continue;
    }
    const match = !fence && line[0].match(heading);
    if (!match) continue;
    scenes.push({ title: match[1].trim(), label: match[2].trim(), number: match[3] ? parseChapterNumber(match[3]) : scenes.length + 1, start: line.index, block: '' });
  }
  for (const [index, scene] of scenes.entries())
    scene.block = content.slice(scene.start, scenes[index + 1]?.start ?? content.length);
  return scenes;
}
