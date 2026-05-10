'use client';

import { Popover, Stack, Text } from '@amboss/design-system';
import type { CSSProperties } from 'react';
import type { CategoryLookup, EmbeddedCode } from './code-utils';

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
  maxWidth: 320,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  verticalAlign: 'top',
};

export function CodeChip({
  entry,
  category,
}: {
  entry: EmbeddedCode;
  category?: string;
}) {
  const label = entry.description ?? entry.code;
  const content = (
    <div style={{ padding: 12, maxWidth: 360 }}>
      <Stack space="s">
        <Text weight="bold">{entry.description ?? entry.code}</Text>
        <Text size="xs" color="secondary">
          {entry.code}
        </Text>
        {category && (
          <Stack space="xxs">
            <Text size="xs" color="secondary" weight="bold">
              Category
            </Text>
            <Text size="xs">{category}</Text>
          </Stack>
        )}
        {entry.previouslySuggestedArticleTitle && (
          <Stack space="xxs">
            <Text size="xs" color="secondary" weight="bold">
              Previously suggested article
            </Text>
            <Text size="xs">{entry.previouslySuggestedArticleTitle}</Text>
          </Stack>
        )}
        {entry.coverageScore !== undefined && (
          <Text size="xs">Coverage score: {String(entry.coverageScore)}</Text>
        )}
        {entry.importance !== undefined && (
          <Text size="xs">Importance: {String(entry.importance)}</Text>
        )}
      </Stack>
    </div>
  );

  return (
    <Popover content={content}>
      <button type="button" style={buttonStyle} title={label}>
        {label}
      </button>
    </Popover>
  );
}

export function CodeChipList({
  codes,
  categoryLookup,
}: {
  codes: EmbeddedCode[];
  categoryLookup?: CategoryLookup;
}) {
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
        <CodeChip
          key={c.code}
          entry={c}
          category={c.category ?? categoryLookup?.[c.code]}
        />
      ))}
    </div>
  );
}
