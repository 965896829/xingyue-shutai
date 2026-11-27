export async function reviewDownload(ids: string[], read: (batch: string[]) => Promise<{ html: string }>) {
  if (ids.length <= 100) {
    const page = await read(ids);
    return { filename: '星月书台-匿名试读.html', blob: new Blob([page.html], { type: 'text/html;charset=utf-8' }) };
  }
  const { Zip, ZipPassThrough, strToU8 } = await import('fflate');
  const parts: ArrayBuffer[] = [];
  const archive = new Zip((error, chunk) => {
    if (error) throw error;
    parts.push(Uint8Array.from(chunk).buffer);
  });
  for (let start = 0; start < ids.length; start += 100) {
    const end = Math.min(start + 100, ids.length);
    const { html } = await read(ids.slice(start, end));
    const file = new ZipPassThrough(`试读-${start + 1}-${end}.html`);
    archive.add(file);
    file.push(strToU8(html), true);
  }
  archive.end();
  return { filename: '星月书台-全部匿名试读.zip', blob: new Blob(parts, { type: 'application/zip' }) };
}
