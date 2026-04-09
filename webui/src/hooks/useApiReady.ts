import { useEffect, useRef, useState } from 'react';
import type { ModelOption } from '../bridge';

export function useApiReady(appendConsole: (msg: string) => void) {
  const [apiReady, setApiReady] = useState(false);
  const [bridgeDelayed, setBridgeDelayed] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [fallbackKeys, setFallbackKeys] = useState<string[]>([]);
  const [preferredModel, setPreferredModel] = useState('gemini-3-flash-preview');
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const initDoneRef = useRef(false);
  const inFlightRef = useRef(false);
  const appendConsoleRef = useRef(appendConsole);

  useEffect(() => {
    appendConsoleRef.current = appendConsole;
  }, [appendConsole]);

  useEffect(() => {
    const tryBootstrap = async () => {
      if (initDoneRef.current) return;
      if (inFlightRef.current) return;
      if (!window.pywebview?.api?.load_settings) return;

      inFlightRef.current = true;
      try {
        const cfg = await window.pywebview.api.load_settings();
        if (!window.pywebview?.api) return;
        initDoneRef.current = true;
        setBridgeDelayed(false);
        setApiReady(true);
        appendConsoleRef.current('Connesso a Python.');
        if (cfg?.api_key) setApiKey(cfg.api_key);
        if (cfg?.fallback_keys?.length) setFallbackKeys(cfg.fallback_keys);
        if (cfg?.preferred_model) setPreferredModel(cfg.preferred_model);
        if (cfg?.fallback_models?.length) setFallbackModels(cfg.fallback_models);
        if (cfg?.available_models?.length) setAvailableModels(cfg.available_models);
      } catch (e) {
        console.error('Load settings failed:', e);
      } finally {
        inFlightRef.current = false;
      }
    };

    window.addEventListener('pywebviewready', tryBootstrap);
    tryBootstrap();

    const delayedWarning = setTimeout(() => {
      if (initDoneRef.current) return;
      setBridgeDelayed(true);
      tryBootstrap();
    }, 5000);

    return () => {
      window.removeEventListener('pywebviewready', tryBootstrap);
      clearTimeout(delayedWarning);
    };
  }, []);

  return {
    apiReady,
    bridgeDelayed,
    apiKey,
    setApiKey,
    fallbackKeys,
    setFallbackKeys,
    preferredModel,
    setPreferredModel,
    fallbackModels,
    setFallbackModels,
    availableModels,
  };
}
