'use client';

import { Popover, Stack, Text } from '@amboss/design-system';
import type { CSSProperties } from 'react';
import type { CodeRecord, CoveredSection } from '@/lib/pb/types';

export type CodeMap = Record<string, CodeRecord>;

const buttonStyle: CSSProperties = {
  display: 'inline-block',
  border: '1px solid rgb(210, 210, 215)',
  borderRadius: 4,
  padding: '0 6px',
  margin: '1px 2px',
  background: 'rgb(248, 248, 250)',
  color: 'rgb(40, 40, 50)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.85em',
  lineHeight: 1.5,
  whiteSpace: 'nowrap',
};

function CoveredArticles({ records }: { records: CoveredSection[] | undefined }) {
  if (!records || records.length === 0) return null;
  return (
    <Stack space="xxs">
      <Text size="xs" color="secondary" weight="bold">
        Existing AMBOSS coverage
      </Text>
      {records.map((r) => (
        <Text size="xs" key={`${r.articleId ?? ''}|${r.articleTitle ?? ''}`}>
          {r.articleTitle ?? r.articleId ?? '(unknown article)'}
        </Text>
      ))}
    </Stack>
  );
}

export function CodeChip({ code, info }: { code: string; info?: CodeRecord }) {
  const hasCoverage = info?.coverageLevel || typeof info?.depthOfCoverage === 'number';
  const content = (
    <div style={{ padding: 12, maxWidth: 360 }}>
      <Stack space="s">
        <Text weight="bold">{code}</Text>
        {info?.description && <Text size="s">{info.description}</Text>}
        {info?.category && (
          <Text size="xs" color="secondary">
            Category: {info.category}
          </Text>
        )}
        {info?.consolidationCategory && (
          <Text size="xs" color="secondary">
            Consolidation: {info.consolidationCategory}
          </Text>
        )}
        <CoveredArticles records={info?.articlesWhereCoverageIs} />
        {hasCoverage && (
          <Stack space="xxs">
            <Text size="xs" color="secondary" weight="bold">
              Coverage score
            </Text>
            <Text size="xs">
              {info?.coverageLevel ?? '—'}
              {typeof info?.depthOfCoverage === 'number'
                ? ` (depth ${info.depthOfCoverage})`
                : ''}
            </Text>
          </Stack>
        )}
        {!info && (
          <Text size="xs" color="secondary">
            No code-level info — not in the codes table for this specialty.
          </Text>
        )}
      </Stack>
    </div>
  );

  return (
    <Popover content={content}>
      <button type="button" style={buttonStyle}>
        {code}
      </button>
    </Popover>
  );
}

export function CodeChipList({ codes, codeMap }: { codes: string[]; codeMap: CodeMap }) {
  if (codes.length === 0) return <span>—</span>;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        rowGap: 2,
      }}
    >
      {codes.map((c) => (
        <CodeChip key={c} code={c} info={codeMap[c]} />
      ))}
    </div>
  );
}

/**
 * Normalize the `codes` JSON column on article/section records (declared as
 * `Array<Record<string, unknown>>` in the seed schema) into a deduped list of
 * code strings. Older seeds may have stored plain strings; both shapes are
 * handled.
 */
export function extractCodeStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let s: string | null = null;
    if (typeof item === 'string') s = item;
    else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      if (typeof o.code === 'string') s = o.code;
      else if (typeof o.id === 'string') s = o.id;
    }
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}
