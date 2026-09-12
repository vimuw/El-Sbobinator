import React, { useMemo, useCallback } from 'react';
import { Cpu, Trash2, ArrowUp, ArrowDown, ChevronRight } from 'lucide-react';
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

  const handlePrimaryModelChange = useCallback((nextPrimary: string) => {
    setPreferredModel(nextPrimary);
    setFallbackModels(prev => prev.filter(modelId => modelId !== nextPrimary));
  }, [setPreferredModel, setFallbackModels]);

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
    <div className="space-y-3">
      {/* Primary Model Field */}
      <div className="space-y-1.5">
        <label className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Cpu className="w-4 h-4 text-[var(--accent-text)]" />
          <span>Modello di Trascrizione (Primario)</span>
        </label>
        <CustomSelect
          value={preferredModel}
          onChange={handlePrimaryModelChange}
          options={primaryModelOptions}
        />

        {primaryModelSummary && (
          <p className="text-xs text-[var(--text-secondary)] italic">{primaryModelSummary}</p>
        )}

      </div>

      {/* Fallback Models List - Collapsible disclosure toggle, collapsed by default */}
      <details className="group/model pt-0.5 text-sm">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors min-h-[28px] py-1 select-none">
          <span className="font-semibold flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <ChevronRight className="w-4 h-4 transition-transform duration-200 group-open/model:rotate-90 text-[var(--text-secondary)]" />
            <span>Opzioni avanzate: Modelli di riserva (Fallback)</span>
            {fallbackModels.length > 0 && (
              <span className="ml-1.5 px-1.5 h-5 inline-flex items-center justify-center rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[11px] font-mono font-bold text-[var(--text-secondary)] leading-none">
                {fallbackModels.length}
              </span>
            )}
          </span>
        </summary>

        <div className="mt-2 pl-5 space-y-2.5">
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Se il modello primario fallisce, il sistema tenterà automaticamente i modelli di riserva in questo ordine.
          </p>

          {availableFallbackOptions.length > 0 && (
            <div>
              <CustomSelect
                value=""
                onChange={handleAddFallbackModel}
                options={fallbackSelectOptions}
                placeholder="Aggiungi modello di riserva..."
              />
            </div>
          )}

          {fallbackModels.length > 0 && (
            <div className="space-y-1.5">
              {fallbackModels.map((modelId, index) => {
                const modelObj = availableModels.find(m => m.id === modelId);
                return (
                  <div
                    key={modelId}
                    className="flex items-center justify-between p-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-sm"
                  >
                    <div className="min-w-0 pr-2">
                      <span className="font-semibold text-sm text-[var(--text-primary)] block truncate">
                        {index + 1}. {modelObj?.label || modelId}
                      </span>
                      {modelObj?.summary && (
                        <p className="text-xs text-[var(--text-secondary)] truncate">{modelObj.summary}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveFallbackModel(index, -1)}
                        disabled={index === 0}
                        className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors cursor-pointer"
                        title="Sposta su"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveFallbackModel(index, 1)}
                        disabled={index === fallbackModels.length - 1}
                        className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors cursor-pointer"
                        title="Sposta giù"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFallbackModel(modelId)}
                        className="p-1 hover:bg-[var(--error-subtle)] rounded text-[var(--error-text)] transition-colors cursor-pointer"
                        title="Rimuovi fallback"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </details>
    </div>
  );
});

ModelSection.displayName = 'ModelSection';
