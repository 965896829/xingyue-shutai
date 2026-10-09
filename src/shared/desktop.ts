export type DesktopMenu = 'app' | 'edit' | 'view';
export interface WindowAppearance {
  mode: 'dark' | 'light';
  background: string;
  foreground: string;
}
export interface DesktopApi {
  setAppearance(appearance: WindowAppearance): Promise<void>;
  openMenu(menu: DesktopMenu, position: { x: number; y: number }): Promise<void>;
}
