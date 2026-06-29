'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import type { PipelineMode } from '@/lib/types';

/**
 * Tracks the pipeline mode of the specialty currently being viewed so the
 * secondary nav can keep the right subtab highlighted on `/planning/<slug>`
 * detail pages (whose URL doesn't carry the mode). Set optimistically when a
 * specialty card is clicked and confirmed by the specialty layout on load.
 * Lives above both the nav and the page tree (see `NavShell`).
 */
type SpecialtyModeContextValue = {
  specialtyMode: PipelineMode | null;
  setSpecialtyMode: (mode: PipelineMode | null) => void;
};

const SpecialtyModeContext = createContext<SpecialtyModeContextValue | null>(null);

export function SpecialtyModeProvider({ children }: { children: React.ReactNode }) {
  const [specialtyMode, setSpecialtyMode] = useState<PipelineMode | null>(null);
  const value = useMemo(() => ({ specialtyMode, setSpecialtyMode }), [specialtyMode]);
  return (
    <SpecialtyModeContext.Provider value={value}>
      {children}
    </SpecialtyModeContext.Provider>
  );
}

export function useSpecialtyMode(): SpecialtyModeContextValue {
  const ctx = useContext(SpecialtyModeContext);
  // Tolerate use outside the provider (e.g. isolated tests) with a no-op store.
  return ctx ?? { specialtyMode: null, setSpecialtyMode: () => {} };
}
