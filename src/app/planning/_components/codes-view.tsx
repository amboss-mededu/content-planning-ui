'use client';

import { Badge, Stack, Text } from '@amboss/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { COVERAGE_LEVELS, type Code } from '@/lib/types';
import { CodeDetailModal, type DetailTarget } from './code-detail-modal';
import { type Column, DataTable } from './data-table';
import { CoverageBadge, DepthBadge } from './suggestion-badge';

function countCoveredSections(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  let n = 0;
  for (const item of items) {
    const sec = (item as { sections?: unknown }).sections;
    if (!sec) continue;
    if (Array.isArray(sec)) n += sec.length;
    else if (typeof sec === 'object')
      n += Object.keys(sec as Record<string, unknown>).length;
  }
  return n;
}

// Coverage level has a natural rank (none < student < ... < specialist) that
// we use for sort ordering, which lines up with how the model scores depth.
const COVERAGE_RANK: Record<string, number> = {
  none: 0,
  student: 1,
  'early-resident': 2,
  'advanced-resident': 3,
  attending: 4,
  specialist: 5,
};

// Predefined filter choices for boolean / categorical columns. Numeric columns
// use the existing comparison filter; string columns without an entry here
// derive their options from unique row values.
const COVERAGE_FILTER_OPTIONS = COVERAGE_LEVELS.map((v) => ({ value: v, label: v }));
const IN_AMBOSS_FILTER_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export function CodesView({
  codes: initialCodes,
  specialtySlug,
  canEdit,
  lockStatus,
  inFlightCodes,
}: {
  codes: Code[];
  specialtySlug: string;
  canEdit: boolean;
  lockStatus: string | null;
  inFlightCodes: string[];
}) {
  const inFlightSet = useMemo(() => new Set(inFlightCodes), [inFlightCodes]);

  // Polling for in-flight mappings now lives in `CodesViewClient` via
  // TanStack Query's `refetchInterval` — the cached query is the source of
  // truth for codes data, and `router.refresh()` would not update it.

  // Mirror the server-loaded codes into local state so inline edits and the
  // Map/Remap action can repaint optimistically before the server round-trip
  // + router.refresh() completes. When the server sends a new list, merge it
  // into the existing array keyed by `code` so a row that was at position N
  // before mapping stays at position N afterwards — only the row's data is
  // updated, the order isn't reshuffled by whatever the server query returns.
  const [codes, setCodes] = useState<Code[]>(initialCodes);
  useEffect(() => {
    setCodes((prev) => {
      if (prev.length === 0) return initialCodes;
      const byCode = new Map(initialCodes.map((c) => [c.code, c]));
      const seen = new Set<string>();
      const merged: Code[] = [];
      for (const c of prev) {
        const next = byCode.get(c.code);
        if (next) {
          merged.push(next);
          seen.add(c.code);
        }
      }
      for (const c of initialCodes) {
        if (!seen.has(c.code)) merged.push(c);
      }
      return merged;
    });
  }, [initialCodes]);

  const [selected, setSelected] = useState<{
    row: Code;
    target: DetailTarget;
  } | null>(null);

  const onOpenDetail = useCallback(
    (r: Code, target: DetailTarget) => setSelected({ row: r, target }),
    [],
  );

  const columns = useMemo<Column<Code>[]>(() => {
    // The metadata cells all open the row's detail modal. Clicking any of
    // them (Source, Code, Description, Category, Consolidation category) is
    // the universal "open this row" affordance — works for unmapped rows
    // too, since the coverage chips don't render until a code is mapped.
    const openMeta = (r: Code) => onOpenDetail(r, 'coverage-articles');
    return [
      {
        key: 'source',
        label: 'Source',
        description: 'Ontology this code came from (ICD10, HCUP, ABIM, Orpha)',
        render: (r) => (
          <ClickableCell onClick={() => openMeta(r)} title="Open code details">
            {r.source ?? '—'}
          </ClickableCell>
        ),
        width: 80,
        accessor: (r) => r.source ?? null,
        type: 'string',
        filterable: true,
        group: 'metadata',
      },
      {
        key: 'code',
        label: 'Code',
        description:
          'Identifier of the code in its source ontology — click to open details',
        // Plain text — no <code> wrapper, which used to introduce UA-default
        // monospace styling that made this column read differently from its
        // metadata neighbors even after fontFamily overrides.
        render: (r) => (
          <ClickableCell onClick={() => openMeta(r)} title="Open code details">
            {r.code}
          </ClickableCell>
        ),
        width: 180,
        accessor: (r) => r.code ?? null,
        type: 'string',
        group: 'metadata',
      },
      {
        key: 'description',
        label: 'Description',
        description: 'Human-readable description of the code from the source ontology',
        // Default widths matter under tableLayout: fixed — without them, the
        // table squeezes these columns to whatever's left after the explicit
        // widths and the nowrap headers overflow into neighbors. Drag-resize
        // still overrides on a per-column basis.
        width: 320,
        render: (r) => (
          <ClickableCell onClick={() => openMeta(r)} title="Open code details">
            <span style={{ textAlign: 'left' }}>{r.description ?? ''}</span>
          </ClickableCell>
        ),
        accessor: (r) => r.description ?? null,
        type: 'string',
        // Free-form text — a checkbox list of unique descriptions would be
        // useless across thousands of rows. Use the substring-contains
        // filter instead.
        filterable: true,
        filterMode: 'contains',
        group: 'metadata',
      },
      {
        key: 'category',
        label: 'Category',
        description: 'Category from the source ontology this code belongs to',
        width: 200,
        render: (r) => (
          <ClickableCell onClick={() => openMeta(r)} title="Open code details">
            {r.category ?? '—'}
          </ClickableCell>
        ),
        accessor: (r) => r.category ?? null,
        type: 'string',
        filterable: true,
        group: 'metadata',
      },
      {
        key: 'consolidationCategory',
        label: 'Consolidation category',
        description: 'Bucket this code was assigned to during consolidation/dedup',
        width: 220,
        render: (r) => (
          <ClickableCell onClick={() => openMeta(r)} title="Open code details">
            {r.consolidationCategory ?? '—'}
          </ClickableCell>
        ),
        accessor: (r) => r.consolidationCategory ?? null,
        type: 'string',
        filterable: true,
        group: 'metadata',
      },
      {
        key: 'inAmboss',
        label: 'In AMBOSS',
        description: 'Whether this code is already covered by an AMBOSS article',
        width: 110,
        render: (r) => {
          if (inFlightSet.has(r.code)) return <MappingPulse />;
          if (r.isInAMBOSS === true) {
            return (
              <ClickableCell onClick={() => onOpenDetail(r, 'coverage-articles')}>
                <Badge text="Yes" color="green" />
              </ClickableCell>
            );
          }
          if (r.isInAMBOSS === false) {
            return (
              <ClickableCell onClick={() => onOpenDetail(r, 'coverage-articles')}>
                <Badge text="No" color="red" />
              </ClickableCell>
            );
          }
          return <EmptyChip />;
        },
        // true → 1, false → 0, unknown → null so unmapped rows stay at the
        // bottom regardless of sort direction.
        accessor: (r) => (r.isInAMBOSS === true ? 1 : r.isInAMBOSS === false ? 0 : null),
        type: 'boolean',
        filterable: true,
        // Map the boolean to friendly Yes/No values; unmapped rows return
        // undefined so they don't fall under either bucket and are excluded
        // when the user picks Yes or No.
        filterValue: (r) =>
          r.isInAMBOSS === true ? 'yes' : r.isInAMBOSS === false ? 'no' : undefined,
        filterOptions: IN_AMBOSS_FILTER_OPTIONS,
        group: 'coverage',
      },
      {
        key: 'coverage',
        label: 'Coverage',
        description:
          'Audience level this code is covered for in AMBOSS (none → student → … → specialist)',
        render: (r) => {
          if (inFlightSet.has(r.code)) return <MappingPulse />;
          if (!r.coverageLevel) return <EmptyChip />;
          return (
            <ClickableCell onClick={() => onOpenDetail(r, 'coverage-articles')}>
              <CoverageBadge level={r.coverageLevel} />
            </ClickableCell>
          );
        },
        width: 140,
        // Sort as a number (rank) so asc/desc follow the coverage ladder rather
        // than alphabetical order of the level label.
        accessor: (r) =>
          r.coverageLevel ? (COVERAGE_RANK[r.coverageLevel] ?? -1) : null,
        type: 'number',
        // For the filter dropdown we want the level *string* (not the rank),
        // shown as a fixed list of the six levels rather than unique values.
        filterable: true,
        filterValue: (r) => r.coverageLevel ?? undefined,
        filterOptions: COVERAGE_FILTER_OPTIONS,
        group: 'coverage',
      },
      {
        key: 'depth',
        label: 'Score',
        description:
          'Numeric depth-of-coverage score for this code (higher = better covered)',
        render: (r) => {
          if (inFlightSet.has(r.code)) return <MappingPulse />;
          if (r.depthOfCoverage === undefined || r.depthOfCoverage === null) {
            return <EmptyChip />;
          }
          return (
            <ClickableCell onClick={() => onOpenDetail(r, 'coverage-articles')}>
              <DepthBadge depth={r.depthOfCoverage} level={r.coverageLevel} />
            </ClickableCell>
          );
        },
        width: 90,
        accessor: (r) => r.depthOfCoverage ?? null,
        type: 'number',
        filterable: true,
        group: 'coverage',
      },
      {
        key: 'articlesWhereCoverageIs',
        label: 'Articles',
        description: 'Existing AMBOSS articles (and sections) that cover this code',
        width: 180,
        render: (r) => {
          if (inFlightSet.has(r.code)) return <MappingPulse />;
          const arr = r.articlesWhereCoverageIs ?? [];
          const articles = arr.length;
          const sections = countCoveredSections(arr);
          if (articles === 0) return <EmptyChip />;
          return (
            <ChipButton
              label={
                sections > 0
                  ? `${articles} article${articles === 1 ? '' : 's'} · ${sections} section${sections === 1 ? '' : 's'}`
                  : `${articles} article${articles === 1 ? '' : 's'}`
              }
              tone="coverage"
              onClick={() => onOpenDetail(r, 'coverage-articles')}
            />
          );
        },
        accessor: (r) => r.articlesWhereCoverageIs?.length ?? 0,
        type: 'number',
        filterable: true,
        group: 'coverage',
      },
      {
        key: 'existingArticleUpdates',
        label: 'Updates',
        description: 'Suggested updates to existing AMBOSS articles for this code',
        width: 130,
        render: (r) => {
          if (inFlightSet.has(r.code)) return <MappingPulse />;
          const n = r.existingArticleUpdates?.length ?? 0;
          if (n === 0) return <EmptyChip />;
          return (
            <ChipButton
              label={`${n} update${n === 1 ? '' : 's'}`}
              tone="suggestions"
              onClick={() => onOpenDetail(r, 'suggestion-updates')}
            />
          );
        },
        accessor: (r) => r.existingArticleUpdates?.length ?? 0,
        type: 'number',
        filterable: true,
        group: 'suggestions',
      },
      {
        key: 'newArticlesNeeded',
        label: 'New articles',
        description: 'Brand-new AMBOSS articles proposed to cover this code',
        width: 130,
        render: (r) => {
          if (inFlightSet.has(r.code)) return <MappingPulse />;
          const n = r.newArticlesNeeded?.length ?? 0;
          if (n === 0) return <EmptyChip />;
          return (
            <ChipButton
              label={`${n} new`}
              tone="suggestions"
              onClick={() => onOpenDetail(r, 'suggestion-new-articles')}
            />
          );
        },
        accessor: (r) => r.newArticlesNeeded?.length ?? 0,
        type: 'number',
        filterable: true,
        group: 'suggestions',
      },
    ];
  }, [onOpenDetail, inFlightSet]);

  return (
    <Stack space="m">
      {!canEdit ? (
        <Text color="secondary">
          Consolidation is active{lockStatus ? ` (${lockStatus})` : ''} — edits and
          re-mapping of already-mapped codes are disabled. Reset the consolidation stage
          on the pipeline page to re-enable. Unmapped codes can still be mapped from here.
        </Text>
      ) : null}
      <DataTable
        rows={codes}
        columns={columns}
        getRowKey={(r, i) => `${r.code}-${i}`}
        emptyText="No codes match the current filters."
        // "Mapped" = the workflow has filled in `isInAMBOSS` (yes or no).
        // Computed off the live filtered set so the count tracks whatever
        // slice the user is currently looking at.
        countAddendum={(filtered) => {
          const mapped = filtered.reduce(
            (n, c) => (c.isInAMBOSS === true || c.isInAMBOSS === false ? n + 1 : n),
            0,
          );
          return `${mapped.toLocaleString()} mapped`;
        }}
        storageKey={`codes-table:${specialtySlug}`}
      />
      <CodeDetailModal
        row={selected?.row ?? null}
        target={selected?.target}
        specialtySlug={specialtySlug}
        canEdit={canEdit}
        lockStatus={lockStatus}
        inFlight={selected ? inFlightSet.has(selected.row.code) : false}
        onClose={() => setSelected(null)}
      />
    </Stack>
  );
}

const CHIP_TONES: Record<
  'coverage' | 'suggestions',
  { bg: string; fg: string; border: string }
> = {
  coverage: {
    bg: 'rgba(34, 139, 80, 0.10)',
    fg: 'rgb(15, 95, 50)',
    border: 'rgb(34, 139, 80)',
  },
  suggestions: {
    bg: 'rgba(217, 119, 6, 0.12)',
    fg: 'rgb(133, 77, 14)',
    border: 'rgb(217, 119, 6)',
  },
};

/**
 * Wraps cell content so the whole rendered area is clickable. Used both for
 * coverage cells (In AMBOSS / Coverage / Depth) deep-linking into the modal,
 * and for metadata cells (Source / Code / Description / Category / Consol.)
 * which provide the universal "open this row" affordance — including for
 * unmapped rows that have no chips.
 */
function ClickableCell({
  onClick,
  title = 'Open code details',
  children,
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {children}
    </button>
  );
}

function ChipButton({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: 'coverage' | 'suggestions';
  onClick: () => void;
}) {
  const c = CHIP_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open breakdown"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        borderRadius: 999,
        padding: '2px 10px',
        // Match the DS Tabs nav font (14 Lato, normal weight). Overriding
        // the button UA defaults explicitly so the chip text doesn't shrink
        // to the browser's smaller form-control font.
        fontFamily: 'inherit',
        fontSize: 14,
        fontWeight: 400,
        cursor: 'pointer',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <span>{label}</span>
      <span aria-hidden style={{ fontSize: 14, opacity: 0.8 }}>
        ›
      </span>
    </button>
  );
}

function EmptyChip() {
  return (
    <span
      style={{
        color: 'var(--ads-c-text-tertiary, rgba(0,0,0,0.35))',
        fontSize: 14,
      }}
    >
      —
    </span>
  );
}

/**
 * Live "Mapping…" indicator shown in the row's status cells while the code is
 * part of an active `running` map_codes run. The pulse keyframes are inlined
 * once via a global <style> tag so we don't drag in Emotion just for this.
 */
function MappingPulse() {
  return (
    <>
      <style>{MAPPING_PULSE_KEYFRAMES}</style>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 14,
          fontWeight: 400,
          color: 'rgb(161, 98, 7)',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: 'rgb(234, 179, 8)',
            animation: 'codes-mapping-pulse 1.2s ease-in-out infinite',
          }}
        />
        Mapping…
      </span>
    </>
  );
}

const MAPPING_PULSE_KEYFRAMES = `@keyframes codes-mapping-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}`;
