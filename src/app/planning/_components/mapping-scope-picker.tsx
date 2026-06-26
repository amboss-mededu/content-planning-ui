'use client';

import { Callout, Combobox, SegmentedControl, Stack } from '@amboss/design-system';
import { useMemo } from 'react';
import type { CodeCategorySummary, UnmappedCodePickerRow } from '@/lib/data/codes';

// Sentinels that appear at the top of the category dropdown. We intercept
// them in onChange so they act like actions rather than real selections.
const SELECT_ALL = '__select_all__';
const CLEAR_ALL = '__clear_all__';

function fmtNum(n: number): string {
  return new Intl.NumberFormat().format(n);
}

export type MappingScopeMode = 'categories' | 'codes' | 'approved';

export type MappingScopeValue = {
  mode: MappingScopeMode;
  selectedCats: string[];
  specificCodes: string[];
};

/** Code strings among the unmapped picker rows that are approved for mapping. */
export function approvedUnmappedCodes(unmappedCodes: UnmappedCodePickerRow[]): string[] {
  return unmappedCodes.filter((c) => c.reviewStatus === 'approved').map((c) => c.code);
}

/**
 * Total unmapped codes the current scope would target. Used both for the
 * "Start mapping (N)" button label and to disable submit when N = 0.
 */
export function estimateScopeCount(
  scope: MappingScopeValue,
  categories: CodeCategorySummary[],
  unmappedCount: number,
  approvedCount = 0,
): number {
  if (scope.mode === 'approved') return approvedCount;
  if (scope.mode === 'codes') return scope.specificCodes.length;
  const allValues = categories.map((c) => c.category);
  const allSelected =
    scope.selectedCats.length === allValues.length && allValues.length > 0;
  if (allSelected) return unmappedCount;
  const set = new Set(scope.selectedCats);
  return categories
    .filter((c) => set.has(c.category))
    .reduce((sum, c) => sum + c.unmapped, 0);
}

/**
 * Pure picker UI shared by the Start-mapping form (full pipeline run) and
 * the codes-table Remap modal. Doesn't own submit state — the parent does.
 */
export function MappingScopePicker({
  categories,
  unmappedCodes,
  unmappedCount,
  value,
  onChange,
  /** Curriculum plans gate mapping on approval — offer an "Approved only"
   *  scope that targets every approved, still-unmapped code. */
  showApproved = false,
}: {
  categories: CodeCategorySummary[];
  unmappedCodes: UnmappedCodePickerRow[];
  unmappedCount: number;
  value: MappingScopeValue;
  onChange: (next: MappingScopeValue) => void;
  showApproved?: boolean;
}) {
  const approvedCount = useMemo(
    () => approvedUnmappedCodes(unmappedCodes).length,
    [unmappedCodes],
  );
  const allCategoryValues = useMemo(
    () => categories.map((c) => c.category),
    [categories],
  );
  const allSelected =
    value.selectedCats.length === allCategoryValues.length &&
    allCategoryValues.length > 0;
  const selectedCategoryTotal = useMemo(() => {
    if (allSelected) return unmappedCount;
    const set = new Set(value.selectedCats);
    return categories
      .filter((c) => set.has(c.category))
      .reduce((sum, c) => sum + c.unmapped, 0);
  }, [allSelected, categories, value.selectedCats, unmappedCount]);

  const categoryOptions = useMemo(() => {
    return [
      { value: SELECT_ALL, label: '✓  Select all categories' },
      { value: CLEAR_ALL, label: '✕  Clear all categories' },
      ...categories.map((c) => {
        const mapped = c.total - c.unmapped;
        return {
          value: c.category,
          label: `${c.category} (${mapped}/${c.total} mapped)`,
        };
      }),
    ];
  }, [categories]);

  const codeOptions = useMemo(() => {
    return unmappedCodes.map((c) => ({
      value: c.code,
      label: c.code,
      description: c.description ?? '(no description)',
    }));
  }, [unmappedCodes]);

  const onCategoryChange = (values: string[]) => {
    if (values.includes(SELECT_ALL)) {
      onChange({ ...value, selectedCats: allCategoryValues });
      return;
    }
    if (values.includes(CLEAR_ALL)) {
      onChange({ ...value, selectedCats: [] });
      return;
    }
    onChange({
      ...value,
      selectedCats: values.filter((v) => v !== SELECT_ALL && v !== CLEAR_ALL),
    });
  };

  return (
    <Stack space="xs">
      <SegmentedControl
        label="Mapping scope"
        isLabelHidden
        value={value.mode}
        onChange={(next) => onChange({ ...value, mode: next as MappingScopeMode })}
        options={[
          ...(showApproved
            ? [
                {
                  name: 'mapping-scope',
                  label: 'Approved only',
                  value: 'approved',
                },
              ]
            : []),
          {
            name: 'mapping-scope',
            label: 'Limit to categories',
            value: 'categories',
            disabled: categories.length === 0,
          },
          {
            name: 'mapping-scope',
            label: 'Specific codes',
            value: 'codes',
            disabled: unmappedCodes.length === 0,
          },
        ]}
      />

      {value.mode === 'approved' ? (
        approvedCount > 0 ? (
          <Callout
            type="info"
            text={`Maps all ${fmtNum(approvedCount)} approved, still-unmapped code${
              approvedCount === 1 ? '' : 's'
            }. Approve more codes from a category (Source categories tab) to widen this.`}
          />
        ) : (
          <Callout
            type="warning"
            text="No approved, unmapped codes yet. Approve codes first — open a category from the Source categories tab."
          />
        )
      ) : value.mode === 'categories' ? (
        categories.length > 0 ? (
          <Combobox
            name="mappingCategories"
            label="Limit to categories"
            hint={
              allSelected
                ? `All ${categories.length} categories (${fmtNum(unmappedCount)} unmapped)`
                : `${value.selectedCats.length} of ${categories.length} selected · ${fmtNum(selectedCategoryTotal)} unmapped codes`
            }
            multiple
            value={value.selectedCats}
            onChange={(values) => onCategoryChange(values as string[])}
            options={categoryOptions}
            placeholder="Select categories to map…"
            emptyStateMessage="No categories match the filter."
            maxHeight={320}
            slotProps={{
              tag: {
                clearButtonAriaLabel: 'Remove category',
              },
            }}
          />
        ) : (
          <Callout
            type="info"
            text="No categories yet — extract codes first to populate the filter dropdown."
          />
        )
      ) : unmappedCodes.length > 0 ? (
        <Combobox
          name="specificCodes"
          label="Specific codes"
          hint={
            value.specificCodes.length === 0
              ? `Search ${fmtNum(unmappedCodes.length)} unmapped codes by ID or description`
              : `${value.specificCodes.length} code${value.specificCodes.length === 1 ? '' : 's'} selected`
          }
          multiple
          value={value.specificCodes}
          onChange={(values) => onChange({ ...value, specificCodes: values as string[] })}
          options={codeOptions}
          placeholder="Start typing a code or description…"
          emptyStateMessage="No unmapped codes match your search."
          maxHeight={320}
          filterMethod={(option, query) => {
            if (!query) return true;
            const q = query.toLowerCase();
            const label = option.label.toLowerCase();
            const desc =
              typeof option.description === 'string'
                ? option.description.toLowerCase()
                : '';
            return label.includes(q) || desc.includes(q);
          }}
          slotProps={{
            tag: {
              clearButtonAriaLabel: 'Remove code',
            },
          }}
        />
      ) : (
        <Callout
          type="info"
          text="No unmapped codes available. Everything is already mapped."
        />
      )}
    </Stack>
  );
}
