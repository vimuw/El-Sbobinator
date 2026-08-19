import React, { useMemo, useCallback } from 'react';
import { Cpu, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { ModelOption } from '../../../bridge';
import { CustomSelect } from './CustomSelect';

interface ModelSectionProps {
  preferredModel: string;
  setPreferredModel: (model: string) => void;
  fallbackModels: string[];
  setFallbackModels: React.Dispatch<React.SetStateAction<string[]>>;
  availableModels: ModelOption[];
}

export const ModelSection: React.FC<ModelSectionProps> = React.memo(({
  preferredModel,
  setPreferredModel,
  fallbackModels,
  setFallbackModels,
  availableModels,
}) => {
  const primaryModel = useMemo(
    () => availableModels.find(m => m.id === preferredModel),
    [availableModels, preferredModel],
  );
  const primaryModelSummary = primaryModel?.summary;
  const defaultChunkMinutes = primaryModel?.default_chunk_minutes ?? '—';
  const defaultTemperature = primaryModel?.phase1_temperature ?? '—';

  const handlePrimaryModelChange = useCallback((nextPrimary: string) => {
    setPreferredModel(nextPrimary);
    setFallbackModels(fallbackModels.filter(modelId => modelId !== nextPrimary));
  }, [fallbackModels, setPreferredModel, setFallbackModels]);

  const handleAddFallbackModel = useCallback((nextFallback: string) => {
    if (!nextFallback || nextFallback === preferredModel || fallbackModels.includes(nextFallback)) return;
    setFallbackModels(prev => [...prev, nextFallback]);
  }, [preferredModel, fallbackModels, setFallbackModels]);

  const moveFallbackModel = useCallback((index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= fallbackModels.length) return;
    const nextModels = [...fallbackModels];
    const [moved] = nextModels.splice(index, 1);
    nextModels.splice(nextIndex, 0, moved);
    setFallbackModels(nextModels);
  }, [fallbackModels, setFallbackModels]);

  const removeFallbackModel = useCallback((modelId: string) => {
    setFallbackModels(prev => prev.filter(item => item !== modelId));
  }, [setFallbackModels]);

  const availableFallbackOptions = useMemo(
    () => availableModels.filter(model => model.id !== preferredModel),
    [availableModels, preferredModel],
  );

  const primaryModelOptions = useMemo(
    () => availableModels.map(m => ({
      value: m.id,
      label: m.label,
    })),
    [availableModels],
  );

  const fallbackSelectOptions = useMemo(
    () => availableFallbackOptions.map(m => ({
      value: m.id,
      label: m.label,
      disabled: fallbackModels.includes(m.id),
    })),
    [availableFallbackOptions, fallbackModels],
  );

  return (
    <div className="p-4 rounded-xl border border-[var(--border-subtle)] space-y-5">
      <div>
        <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 mb-0.5">
          <Cpu className="w-4 h-4 text-[var(--accent-text)]" />
          Selezione Modello Gemini
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          Scegli il modello primario per l&apos;elaborazione delle sbobinature e configura i modelli di riserva.
        </p>
      </div>

      {/* Primary Model */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-[var(--text-primary)] block">
          Modello Primario
        </label>
        <CustomSelect
          value={preferredModel}
          onChange={handlePrimaryModelChange}
          options={primaryModelOptions}
        />

        {primaryModelSummary && (
          <p className="text-xs text-[var(--text-muted)] italic">{primaryModelSummary}</p>
        )}

        {/* Small discreet parameters */}
        <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)] pt-1">
          <span>Durata blocco: <span className="font-medium text-[var(--text-secondary)]">{defaultChunkMinutes} min</span></span>
          <span>•</span>
          <span>Temperatura fase 1: <span className="font-medium text-[var(--text-secondary)]">{defaultTemperature}</span></span>
        </div>
      </div>

      {/* Fallback Models List */}
      <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)]">
        <label className="text-xs font-semibold text-[var(--text-primary)] block">
          Modelli di Riserva (Fallback Order)
        </label>
        <p className="text-xs text-[var(--text-muted)]">
          Se il modello primario fallisce o esaurisce la quota, il sistema tenterà automaticamente i modelli di riserva in questo ordine.
        </p>

        {fallbackModels.length > 0 ? (
          <div className="space-y-2">
            {fallbackModels.map((modelId, index) => {
              const modelObj = availableModels.find(m => m.id === modelId);
              return (
                <div
                  key={modelId}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] text-xs"
                >
                  <div>
                    <span className="font-semibold text-[var(--text-primary)] block">
                      {index + 1}. {modelObj?.label || modelId}
                    </span>
                    {modelObj?.summary && (
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{modelObj.summary}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveFallbackModel(index, -1)}
                      disabled={index === 0}
                      className="p-1.5 hover:bg-[var(--sidebar-active-bg)] rounded-lg disabled:opacity-30 transition-colors"
                      title="Sposta su"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveFallbackModel(index, 1)}
                      disabled={index === fallbackModels.length - 1}
                      className="p-1.5 hover:bg-[var(--sidebar-active-bg)] rounded-lg disabled:opacity-30 transition-colors"
                      title="Sposta giù"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFallbackModel(modelId)}
                      className="p-1.5 hover:bg-[var(--error-subtle)] rounded-lg text-[var(--error-text)] transition-colors"
                      title="Rimuovi fallback"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)] italic">Nessun modello di riserva configurato.</p>
        )}

        {availableFallbackOptions.length > 0 && (
          <div className="flex gap-2">
            <CustomSelect
              value=""
              onChange={handleAddFallbackModel}
              options={fallbackSelectOptions}
              placeholder="Aggiungi modello di riserva..."
            />
          </div>
        )}
      </div>
    </div>
  );
});

ModelSection.displayName = 'ModelSection';
