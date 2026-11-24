import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { Profile } from '../shared/types';
import { useDialogs } from './AppDialogs';
import { modelLabel } from './model-label';
import { invokeCommand as invoke } from '../shared/client';
import type { Act } from './AppDialogs';

const coverFonts = [
  { mac: 'PingFang SC', win: 'Microsoft YaHei', macName: '苹方', winName: '微软雅黑' },
  { mac: 'Songti SC', win: 'SimSun', macName: '宋体', winName: '宋体' },
  { mac: 'Heiti SC', win: 'SimHei', macName: '黑体', winName: '黑体' },
  { mac: 'Kaiti SC', win: 'KaiTi', macName: '楷体', winName: '楷体' },
  { mac: 'STFangsong', win: 'FangSong', macName: '仿宋', winName: '仿宋' }
];

export function Cover({ profiles, title, act }: { profiles: Profile[]; title: string; act: Act }) {
  const dialogs = useDialogs(title);
  const mac = window.wenxu?.desktop?.nativeTitleBar ?? navigator.platform.startsWith('Mac');
  const fonts = coverFonts.map(f => ({ family: mac ? f.mac : f.win, label: mac ? f.macName : f.winName }));
  const defaultFont = fonts[0].family;
  const [prompt, setPrompt] = useState(''),
    [profile, setProfile] = useState(''),
    [picture, setPicture] = useState(''),
    [book, setBook] = useState(title),
    [author, setAuthor] = useState(''),
    [font, setFont] = useState(defaultFont),
    [color, setColor] = useState('#ffffff'),
    [size, setSize] = useState(100),
    [x, setX] = useState(512),
    [authorX, setAuthorX] = useState(512),
    [y, setY] = useState(320),
    [authorY, setAuthorY] = useState(1300),
    [generating, setGenerating] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const matched = coverFonts.find(f => f.mac === font || f.win === font);
  const fallback = matched ? (mac ? matched.mac : matched.win) : defaultFont;
  const fontFamily = `${JSON.stringify(font)}, ${JSON.stringify(fallback)}, sans-serif`;
  useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const draw = (image?: HTMLImageElement) => {
      ctx.fillStyle = '#203b38';
      ctx.fillRect(0, 0, 1024, 1536);
      if (image) {
        const scale = Math.max(1024 / image.width, 1536 / image.height);
        ctx.drawImage(
          image,
          (1024 - image.width * scale) / 2,
          (1536 - image.height * scale) / 2,
          image.width * scale,
          image.height * scale
        );
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.shadowColor = '#0007';
      ctx.shadowBlur = 10;
      ctx.font = `700 ${size}px ${fontFamily}`;
      const chars = Array.from(book);
      let line = '',
        row = 0;
      for (const ch of chars) {
        if (ctx.measureText(line + ch).width > 900) {
          ctx.fillText(line, x, y + row * size * 1.3);
          line = ch;
          row++;
        } else line += ch;
      }
      ctx.fillText(line, x, y + row * size * 1.3);
      ctx.font = `36px ${fontFamily}`;
      ctx.fillText(author ? `${author} 著` : '', authorX, authorY);
      ctx.shadowBlur = 0;
    };
    if (picture) {
      const image = new window.Image();
      image.onload = () => draw(image);
      image.src = picture;
    } else draw();
  }, [picture, book, author, fontFamily, color, size, x, y, authorX, authorY]);
  return (
    <div className="page-content cover-studio">
      <header className="studio-heading">
        <h1>封面设计</h1>
          <button
            onClick={() =>
              void act(async () => {
                const files = await invoke('cover.list');
                if (!files.length) throw new Error('尚无已保存封面');
                const name = await dialogs.prompt('输入要打开的配置路径：\n' + files.join('\n'), { title: '打开已保存的封面', inputLabel: '配置路径', defaultValue: files.at(-1) });
                if (name) {
                  const m = await invoke('cover.load', { path: name });
                  setBook(m.book ?? '');
                  setAuthor(m.author ?? '');
                  setFont(m.font || defaultFont);
                  setColor(m.color ?? '#ffffff');
                  setSize(m.size ?? 100);
                  setX(m.x ?? 512);
                  setAuthorX(m.authorX ?? 512);
                  setY(m.y ?? 320);
                  setAuthorY(m.authorY ?? 1300);
                  setPrompt(m.prompt ?? '');
                  setPicture(m.picture ?? '');
                }
              })
            }
          >
            <FolderOpen size={15} />打开已保存的封面
          </button>
      </header>
      <div className="cover-layout">
        <div className="cover-preview">
          <canvas ref={canvas} width={1024} height={1536} aria-label="作品封面预览" />
          <small>封面预览 · 1024 × 1536</small>
        </div>
        <div className="form">
          <section><h3>封面画面</h3>
          <label>
            图像模型
            <select value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="">选择图像模型</option>
              {profiles
                .filter((p) => p.protocol === 'images')
                .map((p) => (
                  <option key={p.id} value={p.id} title={`${p.name} · ${p.baseUrl}`}>
                    {modelLabel(p, profiles)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            画面描述
            <textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="主体、场景、色调、氛围；无需让 AI 写文字"
            />
          </label>
          <button
            className="primary"
            disabled={generating || !profile || !prompt}
            onClick={() => {
              setGenerating(true);
              void act(async () => {
                const r = await invoke('cover.generate', { profileId: profile, prompt });
                setPicture(r.dataUrl);
              }).finally(() => setGenerating(false));
            }}
          >
            {generating ? '正在请求图像…' : '确认生成画面（调用 API）'}
          </button>
          {generating && (
            <button onClick={() => void invoke('cover.cancel')}>停止请求（服务端费用状态可能未知）</button>
          )}
          </section>
          <section><h3>封面文字</h3>
          <label>
            书名
            <input value={book} onChange={(e) => setBook(e.target.value)} />
          </label>
          <label>
            作者名
            <input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <details className="cover-typesetting"><summary>字体与位置</summary><div>
          <label>
            字体
            <select value={font} onChange={(e) => setFont(e.target.value)}>
              {!fonts.some(f => f.family === font) && <option value={font}>{font}（已保存）</option>}
              {fonts.map(f => (
                <option key={f.family} value={f.family}>{f.label}</option>
              ))}
            </select>
          </label>
          <label>
            文字颜色
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label>
            书名字号 {size}
            <input
              type="range"
              min="40"
              max="160"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </label>
          <label>
            书名纵向位置
            <input
              type="range"
              min="100"
              max="1200"
              value={y}
              onChange={(e) => setY(Number(e.target.value))}
            />
          </label>
          <label>
            书名横向位置
            <input
              type="range"
              min="100"
              max="924"
              value={x}
              onChange={(e) => setX(Number(e.target.value))}
            />
          </label>
          <label>
            作者名横向位置
            <input
              type="range"
              min="100"
              max="924"
              value={authorX}
              onChange={(e) => setAuthorX(Number(e.target.value))}
            />
          </label>
          <label>
            作者名纵向位置
            <input
              type="range"
              min="100"
              max="1450"
              value={authorY}
              onChange={(e) => setAuthorY(Number(e.target.value))}
            />
          </label>
          </div></details>
          </section>
          <button
            className="primary"
            onClick={() =>
              void act(
                () =>
                  invoke('cover.save', {
                    dataUrl: canvas.current!.toDataURL('image/png'),
                    metadata: { book, author, font, color, size, x, y, authorX, authorY, prompt, picture }
                  }),
                '封面和文字配置已保存到作品的 10_封面 目录'
              )
            }
          >
            保存 PNG 与可编辑配置
          </button>
        </div>
      </div>
    </div>
  );
}
