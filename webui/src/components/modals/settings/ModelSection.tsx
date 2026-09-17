import React, { useMemo, useCallback } from 'react';
import { Cpu } from 'lucide-react';
import type { ModelOption } from '../../../bridge';
import { sortModelsByVersion } from '../../../utils';
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
  const sortedModels = useMemo(
    () => sortModelsByVersion(availableModels),
    [availableModels]
  );

  const primaryModel = useMemo(
    () => sortedModels.find(m => m.id === preferredModel),
    [sortedModels, preferredModel],
  );
  const primaryModelSummary = primaryModel?.summary;

  const handlePrimaryModelChange = useCallback((nextPrimary: string) => {
    setPreferredModel(nextPrimary);
  }, [setPreferredModel]);

  const primaryModelOptions = useMemo(
    () => sortedModels.map(m => ({
      value: m.id,
      label: m.label,
    })),
    [sortedModels],
  );

  return (
    <div className="space-y-3">
      {/* Primary Model Field */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
            Modello di Trascrizione (Primario)
          </h3>
        </div>
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
