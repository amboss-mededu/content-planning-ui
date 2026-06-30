import type { MappingSource } from '@/lib/types';

/**
 * Single source of truth for the coverage-source picker's wording and the
 * staging/prod gate, shared by every surface that lets the user choose a
 * mapping source (the add-specialty modal and the specialty settings modal).
 * Keeping the label/options/hint here is what stops the surfaces from drifting
 * apart again.
 *
 * The `guidelines` track is served from the RAG DB in every mode, so it is
 * labeled "RAG DB" everywhere (not just rag-corpus); `amboss` is "AMBOSS
 * content". This matches the codes table's coverage column labels.
 */

export const COVERAGE_SOURCE_LABEL = 'Coverage source';

/** Option list for the picker. The guidelines track is the RAG DB. */
export function coverageSourceOptions(): { value: MappingSource; label: string }[] {
  return [
    { value: 'guidelines', label: 'RAG DB' },
    { value: 'amboss', label: 'AMBOSS content' },
    { value: 'both', label: 'Both (RAG DB + AMBOSS)' },
  ];
}

/** Helper text shown beneath the picker. `locked` is curriculum-mapping, which
 *  always assesses against AMBOSS and disables the control. */
export function coverageSourceHint({ locked }: { locked: boolean }): string {
  if (locked) return 'Curriculum mapping always assesses coverage against AMBOSS.';
  return 'Assess coverage against the RAG DB, AMBOSS content, or both.';
}

/** Whether the chosen source actually queries the RAG DB (the guidelines
 *  track). Combine with rag-corpus mode at the call site to decide whether to
 *  show the Production/Staging MCP-server selector. */
export function sourceIncludesRagDb(source: MappingSource): boolean {
  return source === 'guidelines' || source === 'both';
}
