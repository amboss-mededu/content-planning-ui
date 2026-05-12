'use client';

import { H2, Stack, Text } from '@amboss/design-system';
import type { OntologySource } from '@/lib/types';
import { type Column, DataTable } from './data-table';

type Row = Record<string, unknown>;

function columnsFor(source: OntologySource): Column<Row>[] {
  const s = (k: string, label: string, width?: number): Column<Row> => ({
    key: k,
    label,
    render: (r) => (r[k] as string | number | undefined) ?? '—',
    width,
  });
  switch (source) {
    case 'ICD10':
      return [
        s('codeCategory', 'Category'),
        s('icd10Code', 'ICD-10', 120),
        s('icd10CodeDescription', 'Description'),
      ];
    case 'HCUP':
      return [
        s('icd10Code', 'ICD-10', 120),
        s('icd10CodeDescription', 'Description'),
        s('codeCategory', 'Category'),
      ];
    case 'ABIM':
      return [
        s('primaryCategory', 'Primary'),
        s('secondaryCategory', 'Secondary'),
        s('tertiaryCategory', 'Tertiary'),
        s('disease', 'Disease'),
        s('code', 'Code', 140),
      ];
    case 'Orpha':
      return [
        s('orphaCode', 'Orpha', 100),
        s('specificName', 'Name'),
        s('parentOrphaCode', 'Parent', 100),
        s('parentCategory', 'Parent category'),
      ];
  }
}

export function SourcesView({ source, rows }: { source: OntologySource; rows: Row[] }) {
  return (
    <Stack space="m">
      <H2>{source}</H2>
      <Text color="secondary">{rows.length.toLocaleString()} rows.</Text>
      <DataTable
        rows={rows}
        columns={columnsFor(source)}
        getRowKey={(_, i) => `${source}-${i}`}
        storageKey={`sources-table:${source}`}
      />
    </Stack>
  );
}
