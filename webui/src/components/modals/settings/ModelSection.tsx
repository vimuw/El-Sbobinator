import React, { useMemo, useCallback } from 'react';
import type { ModelOption } from '../../../bridge';
import { sortModelsByVersion, DEFAULT_MODEL } from '../../../utils';
import { CustomSelect } from './CustomSelect';
import { Cpu } from 'lucide-react';
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
      // The profile's short note (e.g. "Più lento"), shown as text so touch screens see it too.
      sublabel: m.summary || undefined,
    })),
    [sortedModels],
  );

  return (
    <div className="space-y-2">
      <SettingsSectionHeading icon={Cpu}>Modello di trascrizione</SettingsSectionHeading>

      <CustomSelect
        value={preferredModel}
        onChange={handlePrimaryModelChange}
        options={primaryModelOptions}
      />
    </div>
  );
});

ModelSection.displayName = 'ModelSection';
