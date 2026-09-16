import React, { useMemo, useCallback } from 'react';
import { Cpu } from 'lucide-react';
import type { ModelOption } from '../../../bridge';
import { CustomSelect } from './CustomSelect';

interface ModelSectionProps {
  preferredModel: string;
  setPreferredModel: (model: string) => void;
  availableModels: ModelOption[];
}

export const ModelSection: React.FC<ModelSectionProps> = React.memo(({
  preferredModel,
  setPreferredModel,
  availableModels,
}) => {
  const primaryModel = useMemo(
    () => availableModels.find(m => m.id === preferredModel),
    [availableModels, preferredModel],
  );
  const primaryModelSummary = primaryModel?.summary;

  const handlePrimaryModelChange = useCallback((nextPrimary: string) => {
    setPreferredModel(nextPrimary);
  }, [setPreferredModel]);

  const primaryModelOptions = useMemo(
    () => availableModels.map(m => ({
      value: m.id,
      label: m.label,
    })),
    [availableModels],
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
    </div>
  );
});

ModelSection.displayName = 'ModelSection';
