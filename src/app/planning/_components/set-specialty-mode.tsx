'use client';

import { useEffect } from 'react';
import { useSpecialtyMode } from '@/app/specialty-mode-context';
import type { PipelineMode } from '@/lib/types';

/**
 * Publishes the viewed specialty's pipeline mode to the nav so the secondary
 * subtab stays highlighted on `/planning/<slug>` detail pages (whose URL
 * doesn't carry the mode). Mirrors {@link RememberSpecialty}'s effect-only
 * shape; renders nothing.
 */
export function SetSpecialtyMode({ mode }: { mode: PipelineMode }) {
  const { setSpecialtyMode } = useSpecialtyMode();
  useEffect(() => {
    setSpecialtyMode(mode);
  }, [mode, setSpecialtyMode]);
  return null;
}
