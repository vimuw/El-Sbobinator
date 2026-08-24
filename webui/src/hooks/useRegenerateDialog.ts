import { useCallback, useState } from 'react';

export interface UseRegenerateDialogOptions {
  previewContent: string | null;
  previewSessionDir: string;
  closePreview: () => void;
}

export function useRegenerateDialog({
  previewContent,
  previewSessionDir,
  closePreview,
}: UseRegenerateDialogOptions) {
  const [regeneratePrompt, setRegeneratePrompt] = useState<{ filename: string; mode?: 'completed' | 'resume'; sessionDir?: string } | null>(null);
  const [regenDirtyConfirm, setRegenDirtyConfirm] = useState<{ filename: string } | null>(null);

  const handleRegenerateAnswer = useCallback(async (ans: boolean | null) => {
    const currentPrompt = regeneratePrompt;
    setRegeneratePrompt(null);
    try {
      if (ans === true && previewContent !== null) {
        const regenDir = (currentPrompt?.sessionDir ?? '').replace(/\\/g, '/').toLowerCase();
        const previewDir = previewSessionDir.replace(/\\/g, '/').toLowerCase();
        if (regenDir && previewDir && regenDir === previewDir) {
          const dirtyContent = (window as unknown as Record<string, () => unknown>).__elSbobinatorGetDirtyEditorContent?.();
          if (dirtyContent) {
            const flushFn = (window as unknown as Record<string, () => Promise<boolean>>).__elSbobinatorFlushPendingAutosave;
            if (flushFn) {
              const flushed = await flushFn();
              if (!flushed) {
                try {
                  if (window.pywebview?.api?.answer_regenerate) await window.pywebview.api.answer_regenerate(false);
                } catch (e) { console.error('Failed to send regen cancel after flush error:', e); }
                return;
              }
            }
            setRegenDirtyConfirm({ filename: currentPrompt?.filename ?? '' });
            return;
          }
          const cancelFn = (window as unknown as Record<string, () => void>).__elSbobinatorCancelPendingAutosave;
          cancelFn?.();
          closePreview();
        }
      }
      if (window.pywebview?.api?.answer_regenerate) await window.pywebview.api.answer_regenerate(ans);
    } catch (e) { console.error('Failed to send answer to Python:', e); }
  }, [closePreview, previewContent, previewSessionDir, regeneratePrompt]);

  const handleRegenDirtyConfirm = useCallback(async () => {
    setRegenDirtyConfirm(null);
    const cancelFn = (window as unknown as Record<string, () => void>).__elSbobinatorCancelPendingAutosave;
    cancelFn?.();
    closePreview();
    try {
      if (window.pywebview?.api?.answer_regenerate) await window.pywebview.api.answer_regenerate(true);
    } catch (e) { console.error('Failed to send regen answer:', e); }
  }, [closePreview]);

  const handleRegenDirtyCancel = useCallback(async () => {
    setRegenDirtyConfirm(null);
    try {
      if (window.pywebview?.api?.answer_regenerate) await window.pywebview.api.answer_regenerate(false);
    } catch (e) { console.error('Failed to send regen cancel:', e); }
  }, []);

  return {
    regeneratePrompt,
    setRegeneratePrompt,
    regenDirtyConfirm,
    setRegenDirtyConfirm,
    handleRegenerateAnswer,
    handleRegenDirtyConfirm,
    handleRegenDirtyCancel,
  };
}
