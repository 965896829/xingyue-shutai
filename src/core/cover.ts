import { fetch, ProxyAgent } from 'undici';
import type { SecretProfile } from '../shared/types';
import { endpoint, RequestError, boundedBody } from './provider';
import { FileStore, atomicWrite, safePath } from './storage';
import { id } from './domain';
export async function generateCover(
  profile: SecretProfile,
  prompt: string,
  signal: AbortSignal = new AbortController().signal
) {
  if (profile.protocol !== 'images') throw new Error('请选择独立的图像协议配置');
  const dispatcher = profile.proxy ? new ProxyAgent(profile.proxy) : undefined;
  try {
    const response = await fetch(endpoint(profile, 'images/generations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.apiKey}` },
      body: JSON.stringify({
        model: profile.model,
        prompt: `生成小说封面画面，留出书名与作者叠字空间。画面不要文字。${prompt}`,
        n: 1,
        size: profile.imageSize,
        quality: profile.imageQuality
      }),
      dispatcher,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(profile.timeoutSeconds * 1000)])
    });
    if (!response.ok) throw new Error(`图像接口 HTTP ${response.status}，请检查模型及支持的尺寸`);
    const result = JSON.parse((await boundedBody(response.body, 28_000_000)).toString('utf8'));
    const item = result.data?.[0];
    let raw: Buffer;
    if (item?.b64_json) raw = Buffer.from(item.b64_json, 'base64');
    else if (item?.url) {
      const u = new URL(item.url);
      if (u.protocol !== 'https:') throw new Error('图像地址必须为 HTTPS');
      const res = await fetch(u, {
        redirect: 'error',
        dispatcher,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)])
      });
      if (!res.ok) throw new Error('图像下载失败');
      raw = await boundedBody(res.body, 20_000_000);
    } else throw new Error('图像服务未返回图片');
    if (raw.length > 20_000_000) throw new Error('图片超过 20 MB');
    const mime = raw.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : raw[0] === 255 && raw[1] === 216
        ? 'image/jpeg'
        : null;
    if (!mime) throw new Error('只接受 PNG/JPEG 图片');
    return {
      dataUrl: `data:${mime};base64,${raw.toString('base64')}`,
      note: '画面已生成；书名和作者名在本地可编辑叠加。'
    };
  } catch (e) {
    throw new RequestError(`封面请求失败或结果未知，不会自动重发：${(e as Error).message}`, true);
  } finally {
    await dispatcher?.close();
  }
}
export function saveCover(store: FileStore, dataUrl: string, metadata: unknown) {
  if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('封面必须是 PNG');
  const raw = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (raw.length > 20_000_000) throw new Error('图片过大');
  store.putObject(raw);
  const tag = id().slice(0, 8),
    file = `10_封面/封面_${tag}.png`;
  atomicWrite(safePath(store.root, file), raw);
  atomicWrite(safePath(store.root, `10_封面/封面_${tag}.json`), JSON.stringify(metadata, null, 2));
  return file;
}
