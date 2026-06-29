'use client';

import {
  Badge,
  Box,
  Card,
  Collapsible,
  CollapsibleHeader,
  Divider,
  Inline,
  Stack,
  Text,
} from '@amboss/design-system';
import { type ReactNode, useState } from 'react';
import type { CodeRecord } from '@/lib/pb/types';

const UNCATEGORIZED = 'Uncategorized';

/** Mapping verdict → badge, matching the codes-table logic: a verdict only
 *  counts once the mapping workflow has stamped `mappedAt`. */
function mappingBadge(code: CodeRecord): ReactNode {
  const mapped = (code.mappedAt ?? 0) > 0;
  if (mapped && code.isInAMBOSS === true) return <Badge text="Mapped" color="green" />;
  if (mapped && code.isInAMBOSS === false)
    return <Badge text="Not in AMBOSS" color="red" />;
  return <Badge text="Unmapped" color="gray" />;
}

function LabeledLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Inline space="xs" vAlignItems="center">
      <Text size="s" color="secondary" weight="bold">
        {label}
      </Text>
      {typeof children === 'string' ? <Text size="s">{children}</Text> : children}
    </Inline>
  );
}

function CodeItem({ code }: { code: CodeRecord }) {
  const objective = code.curriculumMeta?.learningObjective?.trim();
  const subtopics = code.curriculumMeta?.subtopics?.filter(Boolean) ?? [];
  return (
    <Stack space="xxs">
      <LabeledLine label="Code description:">{code.description || '—'}</LabeledLine>
      <LabeledLine label="Mapping:">{mappingBadge(code)}</LabeledLine>
      <LabeledLine label="Objective:">{objective || '—'}</LabeledLine>
      <LabeledLine label="Sub-topics:">
        {subtopics.length > 0 ? subtopics.join('; ') : '—'}
      </LabeledLine>
    </Stack>
  );
}

function CategorySection({ category, codes }: { category: string; codes: CodeRecord[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <Card outlined>
      <Collapsible isExpanded={isExpanded}>
        <CollapsibleHeader
          space="m"
          vSpace="s"
          onClick={() => setIsExpanded((v) => !v)}
          expandedIconAriaLabel={`Collapse ${category}`}
          collapsedIconAriaLabel={`Expand ${category}`}
        >
          <Text weight="bold">
            {category} ({codes.length})
          </Text>
        </CollapsibleHeader>
        <Box space="m" vSpace="s">
          <Stack space="s">
            {codes.map((code, i) => (
              <Stack key={code.id ?? code.code} space="s">
                {i > 0 ? <Divider /> : null}
                <CodeItem code={code} />
              </Stack>
            ))}
          </Stack>
        </Box>
      </Collapsible>
    </Card>
  );
}

/** Groups codes by category (uncategorised last) into expandable cards, each
 *  listing its codes with description, mapping, objective, and sub-topics. */
export function CurriculumStructure({ codes }: { codes: CodeRecord[] }) {
  const groups = new Map<string, CodeRecord[]>();
  for (const c of codes) {
    const cat = c.category?.trim() || UNCATEGORIZED;
    const bucket = groups.get(cat);
    if (bucket) bucket.push(c);
    else groups.set(cat, [c]);
  }
  const sorted = Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b);
  });

  return (
    <Stack space="m">
      {sorted.length === 0 ? (
        <Text color="secondary">No curriculum items yet.</Text>
      ) : (
        <Stack space="s">
          {sorted.map(([category, group]) => (
            <CategorySection key={category} category={category} codes={group} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
