'use client';

import { Badge, Button, Inline, Stack, Text, Tooltip } from '@amboss/design-system';
import { useCallback, useMemo, useState } from 'react';
import type { CodeCategorySummary, UnmappedCodePickerRow } from '@/lib/data/codes';
import { COVERAGE_LEVELS, type Code } from '@/lib/types';
import { CodeDetailModal, type DetailTarget } from './code-detail-modal';
import { type Column, DataTable } from './data-table';
import { RemapModal } from './remap-modal';
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
  codes,
  specialtySlug,
  canEdit,
  lockStatus,
  supportReady = true,
  inFlightCodes,
  categories,
  unmappedCodes,
  unmappedCount,
  totalCount,
  loadState,
  remapLoading,
  onRequestRemapData,
}: {
  codes: Code[];
  specialtySlug: string;
  canEdit: boolean;
  lockStatus: string | null;
  supportReady?: boolean;
  inFlightCodes: string[];
  categories: CodeCategorySummary[];
  unmappedCodes: UnmappedCodePickerRow[];
  unmappedCount: number;
  totalCount?: number;
  loadState?: 'loading' | 'retrying' | 'complete';
  remapLoading?: boolean;
  onRequestRemapData?: () => Promise<void>;
}) {
  const [remapOpen, setRemapOpen] = useState(false);
  const inFlightSet = useMemo(() => new Set(inFlightCodes), [inFlightCodes]);

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
        align: 'center',
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
        align: 'center',
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
        align: 'center',
        render: (r) => {
          if (inFlightSet.has(r.code)) return <MappingPulse />;
          // `isInAMBOSS` is a non-nullable PB bool; only treat it as a
          // verdict once the mapping workflow has stamped `mappedAt`.
          const mapped = (r.mappedAt ?? 0) > 0;
          if (mapped && r.isInAMBOSS === true) {
            return (
              <ClickableCell onClick={() => onOpenDetail(r, 'coverage-articles')}>
                <Badge text="Yes" color="green" />
              </ClickableCell>
            );
          }
          if (mapped && r.isInAMBOSS === false) {
            return (
              <ClickableCell onClick={() => onOpenDetail(r, 'coverage-articles')}>
                <Badge text="No" color="red" />
              </ClickableCell>
            );
          }
          return <EmptyChip />;
        },
        // mapped+true → 1, mapped+false → 0, unmapped → null so unmapped
        // rows stay at the bottom regardless of sort direction.
        accessor: (r) => {
          const mapped = (r.mappedAt ?? 0) > 0;
          if (!mapped) return null;
          return r.isInAMBOSS === true ? 1 : 0;
        },
        type: 'boolean',
        filterable: true,
        // Map the boolean to friendly Yes/No values; unmapped rows return
        // undefined so they don't fall under either bucket and are excluded
        // when the user picks Yes or No.
        filterValue: (r) => {
          const mapped = (r.mappedAt ?? 0) > 0;
          if (!mapped) return undefined;
          return r.isInAMBOSS === true ? 'yes' : 'no';
        },
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
        align: 'center',
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
          // depthOfCoverage is `NUMERIC DEFAULT 0 NOT NULL` — unmapped rows
          // come back as 0, not null. Gate on `mappedAt` for the same reason
          // as the In AMBOSS column above.
          const mapped = (r.mappedAt ?? 0) > 0;
          if (!mapped || r.depthOfCoverage === undefined || r.depthOfCoverage === null) {
            return <EmptyChip />;
          }
          return (
            <ClickableCell onClick={() => onOpenDetail(r, 'coverage-articles')}>
              <DepthBadge depth={r.depthOfCoverage} level={r.coverageLevel} />
            </ClickableCell>
          );
        },
        width: 90,
        align: 'center',
        accessor: (r) => ((r.mappedAt ?? 0) > 0 ? (r.depthOfCoverage ?? null) : null),
        type: 'number',
        filterable: true,
        filterValue: (r) =>
          (r.mappedAt ?? 0) > 0 && typeof r.depthOfCoverage === 'number'
            ? String(r.depthOfCoverage)
            : undefined,
        group: 'coverage',
      },
      {
        key: 'articlesWhereCoverageIs',
        label: 'Articles',
        description: 'Existing AMBOSS articles (and sections) that cover this code',
        width: 180,
        align: 'center',
        render: (r) => {
          if (inFlightSet.has(r.code)) return <MappingPulse />;
          const arr = r.articlesWhereCoverageIs ?? [];
          const articles = r.coverageArticleCount ?? arr.length;
          const sections = r.coverageSectionCount ?? countCoveredSections(arr);
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
        accessor: (r) => r.coverageArticleCount ?? r.articlesWhereCoverageIs?.length ?? 0,
        type: 'number',
        filterable: true,
        group: 'coverage',
      },
      {
        key: 'existingArticleUpdates',
        label: 'Updates',
        description: 'Suggested updates to existing AMBOSS articles for this code',
        width: 130,
        align: 'center',
        render: (r) => {
          if (inFlightSet.has(r.code)) return <MappingPulse />;
          const n = r.existingArticleUpdateCount ?? r.existingArticleUpdates?.length ?? 0;
          if (n === 0) return <EmptyChip />;
          return (
            <ChipButton
              label={`${n} update${n === 1 ? '' : 's'}`}
              tone="suggestions"
              onClick={() => onOpenDetail(r, 'suggestion-updates')}
            />
          );
        },
        accessor: (r) =>
          r.existingArticleUpdateCount ?? r.existingArticleUpdates?.length ?? 0,
        type: 'number',
        filterable: true,
        group: 'suggestions',
      },
      {
        key: 'newArticlesNeeded',
        label: 'New articles',
        description: 'Brand-new AMBOSS articles proposed to cover this code',
        width: 130,
        align: 'center',
        render: (r) => {
          if (inFlightSet.has(r.code)) return <MappingPulse />;
          const n = r.newArticleSuggestionCount ?? r.newArticlesNeeded?.length ?? 0;
          if (n === 0) return <EmptyChip />;
          return (
            <ChipButton
              label={`${n} new`}
              tone="suggestions"
              onClick={() => onOpenDetail(r, 'suggestion-new-articles')}
            />
          );
        },
        accessor: (r) => r.newArticleSuggestionCount ?? r.newArticlesNeeded?.length ?? 0,
        type: 'number',
        filterable: true,
        group: 'suggestions',
      },
    ];
  }, [onOpenDetail, inFlightSet]);

  const canRemap = supportReady && canEdit && unmappedCount > 0;
  // Hide the button once every code is mapped — there's nothing left for it to
  // do. While consolidation is active it stays visible but disabled (with a
  // tooltip explaining why); the bulk action remaps unmapped codes, which the
  // consolidation gate locks. Individual unmapped codes can still be mapped
  // from a row's detail modal — see the note below.
  const allMapped = supportReady && unmappedCount === 0;
  const lockedFromRemap = supportReady && !canEdit && unmappedCount > 0;
  const remapButton = (
    <Button
      variant="secondary"
      size="m"
      onClick={async () => {
        await onRequestRemapData?.();
        setRemapOpen(true);
      }}
      disabled={!canRemap || remapLoading}
    >
      {remapLoading ? 'Loading…' : 'Map by category…'}
    </Button>
  );
  return (
    <Stack space="m">
      {supportReady && !canEdit ? (
        <Text color="secondary">
          Consolidation is active{lockStatus ? ` (${lockStatus})` : ''} — edits and
          re-mapping of already-mapped codes are disabled. Reset the consolidation stage
          on the pipeline page to re-enable. Unmapped codes can still be mapped from here.
        </Text>
      ) : null}
      <Inline space="s" vAlignItems="center">
        {allMapped ? null : lockedFromRemap ? (
          <Tooltip content="Consolidation has already been run — reset the consolidation stage to re-enable bulk mapping.">
            <span style={{ display: 'inline-flex' }}>{remapButton}</span>
          </Tooltip>
        ) : (
          remapButton
        )}
        <Text color="secondary">
          {!supportReady
            ? 'Loading mapping controls…'
            : unmappedCount === 0
              ? 'All codes mapped.'
              : `${unmappedCount.toLocaleString()} unmapped`}
        </Text>
      </Inline>
      <DataTable
        rows={codes}
        columns={columns}
        getRowKey={(r, i) => `${r.code}-${i}`}
        emptyText="No codes match the current filters."
        leadingNote={getLoadStatusText(loadState, totalCount, codes.length)}
        countAddendum={(filtered) => {
          const mapped = filtered.reduce(
            (n, c) => ((c.mappedAt ?? 0) > 0 ? n + 1 : n),
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
        supportReady={supportReady}
        inFlight={selected ? inFlightSet.has(selected.row.code) : false}
        onClose={() => setSelected(null)}
      />
      <RemapModal
        key={`remap-${categories.length}`}
        open={remapOpen}
        onClose={() => setRemapOpen(false)}
        specialtySlug={specialtySlug}
        categories={categories}
        unmappedCodes={unmappedCodes}
        unmappedCount={unmappedCount}
      />
    </Stack>
  );
}

function getLoadStatusText(
  loadState: 'loading' | 'retrying' | 'complete' | undefined,
  totalCount: number | undefined,
  loadedCount: number,
): string | undefined {
  if (loadState === 'retrying') return 'Loading paused; retrying…';
  if (loadState === 'complete') return 'All rows loaded.';
  if (loadState !== 'loading') return undefined;
  if (totalCount === undefined) return 'Loading more rows…';
  return `Loading ${Math.max(0, totalCount - loadedCount).toLocaleString()} more rows…`;
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
        // Center the badge / chip inside the button by default. If the
        // button is content-sized this is a no-op; if it's been forced
        // to fill the cell width (UA defaults on <button>, fixed table
        // layout, etc.) the inner badge stops sitting flush-left and
        // sits in the visual center.
        justifyContent: 'center',
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
