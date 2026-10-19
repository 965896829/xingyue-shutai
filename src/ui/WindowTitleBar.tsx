import { useEffect, useRef, useState } from 'react';
import type { DesktopMenu } from '../shared/desktop';
import { brand } from '../shared/brand';
import { brandAssets } from './BrandLogo';

const menus: { id: DesktopMenu; label: string; key: string }[] = [
  { id: 'app', label: brand.name, key: 'w' },
  { id: 'edit', label: '编辑', key: 'e' },
  { id: 'view', label: '视图', key: 'v' }
];

export function WindowTitleBar() {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState<DesktopMenu | null>(null);

  const open = async (index: number) => {
    const button = buttons.current[index];
    if (!button || !window.wenxu?.desktop) return;
    const rect = button.getBoundingClientRect();
    setActive(menus[index].id);
    try {
      await window.wenxu.desktop.openMenu(menus[index].id, { x: rect.left, y: rect.bottom });
    } catch {
      console.warn('窗口菜单无法打开');
    } finally {
      setActive(null);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F10' && !event.shiftKey) {
        event.preventDefault();
        buttons.current[0]?.focus();
      }
      if (event.altKey && !event.ctrlKey && !event.shiftKey) {
        const index = menus.findIndex((menu) => menu.key === event.key.toLowerCase());
        if (index >= 0) {
          event.preventDefault();
          void open(index);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Browser previews and non-desktop renderers have no window controls to manage.
  if (!window.wenxu?.desktop) return null;
  return (
    <header className="window-titlebar">
      <div className="window-titlebar-safe">
        <div className="window-title">
          <img className="window-brand-icon" src={brandAssets.app} width={18} height={18} alt="" />
          <span>{brand.windowTitle}</span>
        </div>
        <nav className="window-menus" aria-label="应用菜单">
          {menus.map((menu, index) => (
            <button
              key={menu.id}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              aria-haspopup="menu"
              aria-expanded={active === menu.id}
              title={`${menu.label} (Alt+${menu.key.toUpperCase()})`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void open(index)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  buttons.current[
                    (index + (event.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length
                  ]?.focus();
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  void open(index);
                }
              }}
            >
              {menu.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
