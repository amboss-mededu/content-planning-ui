'use client';

import { Popover, Stack, Text } from '@amboss/design-system';
import { type CSSProperties, useState } from 'react';
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
  // Hover-triggered popover. Click is intentionally not wired — the
  // content is read-only metadata, so hover/focus is the right
  // interaction. `isVisible` makes Popover controlled; the user
  // moving off the chip dismisses immediately (no need to keep the
  // popup open since there's nothing to click inside it).
  const [hover, setHover] = useState(false);
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
    <Popover
      content={content}
      isVisible={hover}
      dismissOnOutsideClick={false}
      disableInitialFocus
    >
      <button
        type="button"
        style={buttonStyle}
        title={label}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
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

const groupChipStyle: CSSProperties = {
  ...buttonStyle,
  background: 'rgb(238, 240, 248)',
  borderColor: 'rgb(190, 198, 220)',
  maxWidth: 280,
};

const tableHeadStyle: CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid rgb(220, 222, 230)',
  padding: '4px 8px 6px',
  fontWeight: 600,
  fontSize: 11,
  color: 'rgb(80, 84, 100)',
  whiteSpace: 'nowrap',
};

const tableCellStyle: CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid rgb(240, 240, 245)',
  verticalAlign: 'top',
  fontSize: 12,
};

const FALLBACK_CATEGORY = '— (no category)';

function categoryLeaf(category: string): string {
  // Category paths are concatenated with `;`; the leaf is the last segment
  // and is what an editor recognizes at a glance. Full path stays in the
  // popover header.
  const parts = category
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? category;
}

function CategoryGroupChip({
  category,
  entries,
}: {
  category: string;
  entries: EmbeddedCode[];
}) {
  const [hover, setHover] = useState(false);
  const isFallback = category === FALLBACK_CATEGORY;
  const label = `${isFallback ? '—' : categoryLeaf(category)} (${entries.length})`;
  const content = (
    <div style={{ padding: 12, maxWidth: 520 }}>
      <Stack space="s">
        <Stack space="xxs">
          <Text size="xs" color="secondary" weight="bold">
            Category
          </Text>
          <Text size="xs">{isFallback ? '(uncategorized)' : category}</Text>
        </Stack>
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            fontFamily: 'inherit',
          }}
        >
          <thead>
            <tr>
              <th style={tableHeadStyle}>Code</th>
              <th style={tableHeadStyle}>Previously suggested</th>
              <th style={{ ...tableHeadStyle, textAlign: 'right' }}>Coverage</th>
              <th style={{ ...tableHeadStyle, textAlign: 'right' }}>Importance</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.code}>
                <td style={tableCellStyle}>
                  <div style={{ fontFamily: 'monospace', fontSize: 11 }}>{e.code}</div>
                  {e.description && (
                    <div style={{ color: 'rgb(80, 84, 100)' }}>{e.description}</div>
                  )}
                </td>
                <td style={tableCellStyle}>
                  {e.previouslySuggestedArticleTitle ?? (
                    <span style={{ color: 'rgb(150, 152, 165)' }}>—</span>
                  )}
                </td>
                <td style={{ ...tableCellStyle, textAlign: 'right' }}>
                  {e.coverageScore !== undefined ? String(e.coverageScore) : '—'}
                </td>
                <td style={{ ...tableCellStyle, textAlign: 'right' }}>
                  {e.importance !== undefined ? String(e.importance) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Stack>
    </div>
  );

  return (
    <Popover
      content={content}
      isVisible={hover}
      dismissOnOutsideClick={false}
      disableInitialFocus
      maxWidth={520}
    >
      <button
        type="button"
        style={groupChipStyle}
        title={isFallback ? `${entries.length} uncategorized codes` : category}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {label}
      </button>
    </Popover>
  );
}

/**
 * Collapsed chip-by-category renderer. Use when the flat code list is too
 * dense to scan (>= ~15 codes). Each category becomes one chip; hovering
 * reveals a per-code table with the same metadata the flat CodeChip popover
 * shows (code, previously suggested article title, coverage, importance).
 */
export function CategoryGroupedCodeList({
  codes,
  categoryLookup,
}: {
  codes: EmbeddedCode[];
  categoryLookup?: CategoryLookup;
}) {
  if (codes.length === 0) return <span>—</span>;
  const groups = new Map<string, EmbeddedCode[]>();
  for (const c of codes) {
    const cat = c.category ?? categoryLookup?.[c.code] ?? FALLBACK_CATEGORY;
    const bucket = groups.get(cat);
    if (bucket) bucket.push(c);
    else groups.set(cat, [c]);
  }
  const sorted = Array.from(groups.entries()).sort(([a], [b]) => {
    // Push the fallback bucket last so real categories lead.
    if (a === FALLBACK_CATEGORY) return 1;
    if (b === FALLBACK_CATEGORY) return -1;
    return a.localeCompare(b);
  });
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        rowGap: 2,
      }}
    >
      {sorted.map(([cat, entries]) => (
        <CategoryGroupChip
          key={cat}
          category={cat}
          entries={entries.slice().sort((a, b) => a.code.localeCompare(b.code))}
        />
      ))}
    </div>
  );
}
