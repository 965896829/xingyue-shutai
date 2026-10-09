import { useSyncExternalStore } from 'react';
import { MoonStar, Sun } from 'lucide-react';
import { getColorMode, setColorMode, subscribeColorMode } from './color-mode';

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribeColorMode, getColorMode);
  const label = mode === 'dark' ? '切换到日间模式' : '切换到夜间模式';
  return (
    <button
      className="theme-toggle"
      aria-label={label}
      title={`${label} · 自动记住选择`}
      onClick={() => setColorMode(mode === 'dark' ? 'light' : 'dark')}
    >
      {mode === 'dark' ? <MoonStar size={17} /> : <Sun size={17} />}
      <span>{mode === 'dark' ? '夜间' : '日间'}</span>
    </button>
  );
}
