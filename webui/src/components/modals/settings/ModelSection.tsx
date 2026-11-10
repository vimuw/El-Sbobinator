import React, { useMemo, useCallback } from 'react';
import type { ModelOption } from '../../../bridge';
import { sortModelsByVersion, DEFAULT_MODEL } from '../../../utils';
import { CustomSelect } from './CustomSelect';
import { Cpu } from 'lucide-react';
import { SettingsSectionHeading } from './SettingsLayout';
import { getHostCapabilities } from '../../../hostCapabilities';

// Google gives 2.5 Flash only to projects that already used it. The web build then moves the key to
// 3.6 Flash by itself (webRun.ts); the desktop has no such switch.
export const MODEL_25_ACCESS_NOTE = 'Google consente l’uso solo a chi ha già usato questo modello. Se è la prima volta che lo usi, potrebbe non funzionare.';
export const MODEL_25_ACCESS_NOTE_WEB = 'Google consente l’uso solo a chi ha già usato questo modello. Se la tua chiave non può usarlo, passo da solo a Gemini 3.6 Flash.';

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
      tooltip: m.id === 'gemini-2.5-flash'
        ? (getHostCapabilities().kind === 'web' ? MODEL_25_ACCESS_NOTE_WEB : MODEL_25_ACCESS_NOTE)
        : undefined,
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
