/// <reference types="vite/client" />

// Bridge exposed by the Electron preload (undefined in the dev browser).
interface Window {
  desktop?: {
    isDesktop?: boolean;
    captureOAuth: (authUrl: string) => Promise<string | null>;
    onUpdateDownloaded?: (cb: (info: { version?: string; notes?: string | null }) => void) => () => void;
    onUpdateAvailable?: (cb: (info: { version?: string }) => void) => () => void;
    installUpdate?: () => Promise<boolean>;
  };
}
