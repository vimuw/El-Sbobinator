import React from 'react';
import { Cpu, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { ModelOption } from '../../../bridge';

interface ModelSectionProps {
  preferredModel: string;
  setPreferredModel: (model: string) => void;
  fallbackModels: string[];
  setFallbackModels: React.Dispatch<React.SetStateAction<string[]>>;
  availableModels: ModelOption[];
}

export const ModelSection: React.FC<ModelSectionProps> = ({
  preferredModel,
  setPreferredModel,
  fallbackModels,
  setFallbackModels,
  availableModels,
}) => {
  const primaryModel = availableModels.find(m => m.id === preferredModel);
  const primaryModelSummary = primaryModel?.summary;
  const defaultChunkMinutes = primaryModel?.default_chunk_minutes ?? '—';
  const defaultTemperature = primaryModel?.phase1_temperature ?? '—';

  const handlePrimaryModelChange = (nextPrimary: string) => {
    setPreferredModel(nextPrimary);
    setFallbackModels(fallbackModels.filter(modelId => modelId !== nextPrimary));
  };

  const handleAddFallbackModel = (nextFallback: string) => {
    if (!nextFallback || nextFallback === preferredModel || fallbackModels.includes(nextFallback)) return;
    setFallbackModels(prev => [...prev, nextFallback]);
  };

  const moveFallbackModel = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= fallbackModels.length) return;
    const nextModels = [...fallbackModels];
    const [moved] = nextModels.splice(index, 1);
    nextModels.splice(nextIndex, 0, moved);
    setFallbackModels(nextModels);
  };

  const removeFallbackModel = (modelId: string) => {
    setFallbackModels(prev => prev.filter(item => item !== modelId));
  };

  const availableFallbackOptions = availableModels.filter(model => model.id !== preferredModel);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2 mb-1">
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
        <select
          value={preferredModel}
          onChange={e => handlePrimaryModelChange(e.target.value)}
          className="w-full app-input text-xs font-medium"
        >
          {availableModels.map(m => (
            <option key={m.id} value={m.id}>
              {m.label} ({m.id})
            </option>
          ))}
        </select>

        {primaryModelSummary && (
          <p className="text-xs text-[var(--text-muted)] italic">{primaryModelSummary}</p>
        )}
      </div>

      {/* Model Parameters / Chunk Info */}
      <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)]">
        <div>
          <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase block">Durata Blocco</span>
          <span className="text-sm font-bold text-[var(--text-primary)]">{defaultChunkMinutes} min</span>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase block">Temperatura Fase 1</span>
          <span className="text-sm font-bold text-[var(--text-primary)]">{defaultTemperature}</span>
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
                  className="flex items-center justify-between p-2.5 rounded bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-xs"
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
                      className="p-1 hover:bg-[var(--sidebar-active-bg)] rounded disabled:opacity-30"
                      title="Sposta su"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveFallbackModel(index, 1)}
                      disabled={index === fallbackModels.length - 1}
                      className="p-1 hover:bg-[var(--sidebar-active-bg)] rounded disabled:opacity-30"
                      title="Sposta giù"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFallbackModel(modelId)}
                      className="p-1 hover:bg-[var(--sidebar-active-bg)] rounded text-[var(--error-text)]"
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
            <select
              defaultValue=""
              onChange={e => {
                handleAddFallbackModel(e.target.value);
                e.target.value = '';
              }}
              className="flex-1 app-input text-xs"
            >
              <option value="" disabled>Aggiungi modello di riserva...</option>
              {availableFallbackOptions.map(m => (
                <option key={m.id} value={m.id} disabled={fallbackModels.includes(m.id)}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
};
