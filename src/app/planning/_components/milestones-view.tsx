'use client';

import { Callout, Card, CardBox, H5, Stack, Text } from '@amboss/design-system';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import { StartMilestonesModal } from '../[specialty]/pipeline/_components/start-milestones-modal';
import { useRefreshWhileRunning } from './use-refresh-while-running';

/**
 * Read-only Milestones tab — renders the ACGME-style output written at
 * extract-milestones approval time. The workflow stores whatever the model
 * returns (typically a JSON string of the shape
 * `{"ACGME_Milestones_<specialty>": {"Patient_Care": {"Level_1": [...], …}, …}}`),
 * so we try to parse + render it as a hierarchical tree and fall back to a
 * raw `<pre>` block when the string isn't valid JSON.
 */
export function MilestonesView({
  milestones,
  specialtySlug,
  sources,
  extractionRunning,
}: {
  milestones: string | null;
  specialtySlug: string;
  sources: CodeSource[];
  extractionRunning: boolean;
}) {
  useRefreshWhileRunning(extractionRunning);
  if (!milestones) {
    return (
      <Stack space="l">
        <Callout
          type="info"
          text="No milestones have been approved for this specialty yet."
        />
        <StartMilestonesModal
          specialtySlug={specialtySlug}
          sources={sources}
          running={extractionRunning}
        />
      </Stack>
    );
  }

  const parsed = tryParse(milestones);
  const tree = parsed ? extractTree(parsed) : null;

  return (
    <Stack space="l">
      <StartMilestonesModal
        specialtySlug={specialtySlug}
        sources={sources}
        running={extractionRunning}
      />
      <Card title="Milestones" titleAs="h3" outlined>
        <CardBox>
          <Stack space="m">
            <Text color="secondary">
              Approved ACGME-style output from the latest extract-milestones run.
            </Text>
            {tree ? <MilestonesTree tree={tree} /> : <RawText text={milestones} />}
          </Stack>
        </CardBox>
      </Card>
    </Stack>
  );
}

type Competency = {
  name: string; // "Patient Care" / "Medical Knowledge"
  levels: Array<{ label: string; items: string[] }>;
};

type MilestonesTree = {
  title: string;
  competencies: Competency[];
};

function tryParse(raw: string): unknown {
  const trimmed = raw.trim();
  // The model occasionally wraps output in ```json fences — strip them first.
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const body = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Expected shape: `{ "ACGME_Milestones_<slug>": { "<Competency>": { "Level_1": [...], … } } }`.
 * Accepts any top-level key (`ACGME_Milestones_…`) and any competency key; Level
 * keys sort numerically so Level_10 (if it ever appears) lands after Level_2.
 */
function extractTree(data: unknown): MilestonesTree | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const topKey = Object.keys(obj).find(
    (k) => typeof obj[k] === 'object' && obj[k] !== null,
  );
  if (!topKey) return null;
  const body = obj[topKey] as Record<string, unknown>;
  const competencies: Competency[] = [];
  for (const [compKey, compVal] of Object.entries(body)) {
    if (!compVal || typeof compVal !== 'object') continue;
    const levels: Array<{ label: string; items: string[] }> = [];
    for (const [levelKey, levelVal] of Object.entries(
      compVal as Record<string, unknown>,
    )) {
      if (!Array.isArray(levelVal)) continue;
      const items = levelVal.filter((x): x is string => typeof x === 'string');
      levels.push({ label: prettify(levelKey), items });
    }
    // Sort by the trailing number in `Level_N`
    levels.sort(
      (a, b) =>
        (parseInt(a.label.replace(/\D+/g, ''), 10) || 0) -
        (parseInt(b.label.replace(/\D+/g, ''), 10) || 0),
    );
    if (levels.length > 0) {
      competencies.push({ name: prettify(compKey), levels });
    }
  }
  if (competencies.length === 0) return null;
  return { title: prettify(topKey), competencies };
}

function prettify(key: string): string {
  return key
    .replace(/^ACGME_Milestones_/i, '')
    .replace(/_/g, ' ')
    .trim();
}

function MilestonesTree({ tree }: { tree: MilestonesTree }) {
  return (
    <Stack space="m">
      {tree.title ? <H5>{tree.title}</H5> : null}
      {tree.competencies.map((c) => (
        <Stack key={c.name} space="s">
          <Text weight="bold">{c.name}</Text>
          {c.levels.map((l) => (
            <div key={l.label} style={{ paddingLeft: 12 }}>
              <Text weight="bold">{l.label}</Text>
              <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
                {l.items.map((item) => (
                  <li key={item} style={{ margin: '2px 0', lineHeight: 1.5 }}>
                    <Text>{item}</Text>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}

function RawText({ text }: { text: string }) {
  return (
    <pre
      style={{
        background: 'var(--color-gray-50, #f8f8f8)',
        border: '1px solid var(--color-gray-200, #e5e5e5)',
        borderRadius: 4,
        padding: 12,
        margin: 0,
        fontSize: 13,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        maxHeight: '70vh',
        overflow: 'auto',
      }}
    >
      {text}
    </pre>
  );
}
