import React, { useMemo, useCallback } from 'react';
import type { ModelOption } from '../../../bridge';
import { sortModelsByVersion, DEFAULT_MODEL } from '../../../utils';
import { CustomSelect } from './CustomSelect';
import { SettingsSectionHeading } from './SettingsLayout';

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

  const handlePrimaryModelChange = useCallback((nextPrimary: string) => {
    setPreferredModel(nextPrimary);
  }, [setPreferredModel]);

  const primaryModelOptions = useMemo(
    () => sortedModels.map(m => ({
      value: m.id,
      label: m.label,
      badge: (m.is_default || m.id === DEFAULT_MODEL) ? 'Default' : undefined,
      tooltip: m.id === 'gemini-2.5-flash' ? 'Google consente l’uso solo a chi ha già usato questo modello. Se è la prima volta che lo usi, potrebbe non funzionare.' : undefined,
    })),
    [sortedModels],
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1 min-w-0">
        <SettingsSectionHeading>Modello di trascrizione</SettingsSectionHeading>
      </div>

      <CustomSelect
        value={preferredModel}
        onChange={handlePrimaryModelChange}
        options={primaryModelOptions}
      />
    </div>
  );
});

ModelSection.displayName = 'ModelSection';
