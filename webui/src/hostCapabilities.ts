// What the host running the interface can do. The desktop app (pywebview) can do everything;
// the FastAPI dev host and the static web build turn off what they cannot back, and the UI hides it.
export interface HostCapabilities {
  // desktop: pywebview; browser: FastAPI dev/test host; web: everything runs in this page.
  kind: 'desktop' | 'browser' | 'web';
  fileUpload: boolean;
  fileDrop: boolean;
  nativeFolderPicker: boolean;
  openLocalPath: boolean;
  osNotifications: boolean;
  updateInstallation: boolean;
  realPipeline: boolean;
  credentialPersistence: boolean;
  windowControls: boolean;
  // system: keys protected by the OS (DPAPI/Keychain); browser: plain localStorage on this device.
  keyStorage: 'system' | 'browser';
  // Audio player docked in the editor, linked to the session's media file.
  editorAudio: boolean;
  // .sbobina package import/export.
  sbobinaPackages: boolean;
  // "Verifica ambiente" (FFmpeg, disk, session folder).
  environmentCheck: boolean;
}

export const DESKTOP_CAPABILITIES: HostCapabilities = {
  kind: 'desktop',
  fileUpload: true,
  fileDrop: true,
  nativeFolderPicker: true,
  openLocalPath: true,
  osNotifications: true,
  updateInstallation: true,
  realPipeline: true,
  credentialPersistence: true,
  windowControls: true,
  keyStorage: 'system',
  editorAudio: true,
  sbobinaPackages: true,
  environmentCheck: true,
};

let hostCapabilities: HostCapabilities = DESKTOP_CAPABILITIES;

export function getHostCapabilities(): HostCapabilities {
  return hostCapabilities;
}

export function setHostCapabilities(capabilities: Partial<HostCapabilities>): void {
  hostCapabilities = { ...DESKTOP_CAPABILITIES, ...capabilities };
}
