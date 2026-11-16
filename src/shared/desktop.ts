export type DesktopMenu = 'app' | 'edit' | 'view';
export interface WindowAppearance {
  mode: 'dark' | 'light';
  background: string;
  foreground: string;
  /** Omitted on startup and by older callers; animate only an intentional theme change. */
  animate?: boolean;
}
export interface DesktopApi {
  /** macOS owns its title bar and application menu; older bridges omit this flag. */
  readonly nativeTitleBar?: boolean;
  setAppearance(appearance: WindowAppearance): Promise<void>;
  openMenu(menu: DesktopMenu, position: { x: number; y: number }): Promise<void>;
  onHomeRequested(listener: () => void): () => void;
  onCloseRequested(listener: (requestId: string) => void): () => void;
  respondToClose(requestId: string, action: 'cancel' | 'quit'): Promise<boolean>;
}
