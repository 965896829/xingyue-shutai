export type DesktopMenu = 'app' | 'edit' | 'view';
export interface WindowAppearance {
  mode: 'dark' | 'light';
  background: string;
  foreground: string;
  /** Omitted on startup and by older callers; animate only an intentional theme change. */
  animate?: boolean;
}
export interface DesktopApi {
  setAppearance(appearance: WindowAppearance): Promise<void>;
  openMenu(menu: DesktopMenu, position: { x: number; y: number }): Promise<void>;
  onCloseRequested(listener: (requestId: string) => void): () => void;
  respondToClose(requestId: string, action: 'cancel' | 'quit'): Promise<boolean>;
}
