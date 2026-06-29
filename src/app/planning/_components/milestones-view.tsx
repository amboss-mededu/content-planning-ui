'use client';

import {
  Button,
  Callout,
  Card,
  CardBox,
  H5,
  Inline,
  Stack,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PipelineMode } from '@/lib/types';
import type { CodeSource } from '@/lib/workflows/lib/sources';
import { loadDefaultStudentMilestones } from '../[specialty]/actions';
import { StartMilestonesModal } from '../[specialty]/pipeline/_components/start-milestones-modal';
import { MilestonesEditor } from './milestones-editor';
import { useRefreshWhileRunning } from './use-refresh-while-running';

/**
 * Read-only Milestones tab — renders the milestone output written at
 * extract-milestones approval time. The workflow stores whatever the model
 * returns, in one of two nested-JSON shapes the tree renderer handles:
 *   - clinician (ACGME): `{"ACGME_Milestones_<x>": {"Patient_Care": {"Level_1": [...]}}}`
 *   - curriculum (year-based): `{"Curriculum_Coverage_Levels_<x>": {"Year_1": [...], …}}`
 * Non-JSON strings fall back to a raw `<pre>` block.
 */
export function MilestonesView({
  milestones,
  specialtySlug,
  sources,
  extractionState,
  pipelineMode,
}: {
  milestones: string | null;
  specialtySlug: string;
  sources: CodeSource[];
  extractionState: { running: boolean; completed: boolean; runId: string | null };
  pipelineMode?: PipelineMode;
}) {
  useRefreshWhileRunning(extractionState.running);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [loadingDefault, startLoadDefault] = useTransition();
  const running = extractionState.running;
  const isCurriculum = pipelineMode === 'curriculum-mapping';

  if (!milestones) {
    return (
      <Stack space="l">
        <Callout
          type="info"
          text="No milestones have been approved for this specialty yet."
        />
        <Inline space="s" vAlignItems="center">
          <StartMilestonesModal
            specialtySlug={specialtySlug}
            sources={sources}
            running={running}
            completed={extractionState.completed}
            runId={extractionState.runId}
          />
          {isCurriculum ? (
            <Button
              type="button"
              variant="tertiary"
              disabled={running || loadingDefault}
              onClick={() =>
                startLoadDefault(async () => {
                  await loadDefaultStudentMilestones(specialtySlug);
                  router.refresh();
                })
              }
            >
              {loadingDefault ? 'Loading…' : 'Load default coverage levels'}
            </Button>
          ) : null}
          {!editing ? (
            <Button
              type="button"
              variant="tertiary"
              disabled={running}
              onClick={() => setEditing(true)}
            >
              Add milestones manually
            </Button>
          ) : null}
        </Inline>
        {editing ? (
          <MilestonesEditor
            slug={specialtySlug}
            initialValue=""
            onClose={() => setEditing(false)}
          />
        ) : null}
      </Stack>
    );
  }

  const parsed = tryParse(milestones);
  const tree = parsed ? extractTree(parsed) : null;

  return (
    <Stack space="l">
      <Inline space="s" vAlignItems="center">
        <StartMilestonesModal
          specialtySlug={specialtySlug}
          sources={sources}
          running={running}
          completed={extractionState.completed}
          runId={extractionState.runId}
        />
        {!editing ? (
          <Button
            type="button"
            variant="tertiary"
            disabled={running}
            onClick={() => setEditing(true)}
          >
            Edit milestones
          </Button>
        ) : null}
      </Inline>
      {editing ? (
        <MilestonesEditor
          slug={specialtySlug}
          initialValue={milestones}
          onClose={() => setEditing(false)}
        />
      ) : null}
      <Card title="Milestones" titleAs="h3" outlined>
        <CardBox>
          <Stack space="m">
            <Text color="secondary">
              Approved milestones from the latest extract-milestones run.
            </Text>
            {tree ? <MilestonesTree tree={tree} /> : <RawText text={milestones} />}
          </Stack>
        </CardBox>
      </Card>
    </Stack>
  );
}

type Competency = {
  name: string; // "Patient Care" / "Medical Knowledge" (ACGME) or an EPA name
  // For ACGME, one entry per level (label = "Level 1" …); for the flat EPA
  // shape, a single entry with an empty label (items rendered without a header).
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
 * Handles both milestone shapes:
 *   - ACGME (3 levels): `{ "ACGME_Milestones_<x>": { "<Competency>": { "Level_1": [...], … } } }`
 *   - Core EPAs (2 levels): `{ "Core_EPAs_<x>": { "EPA1_…": [...], … } }`
 * Any top-level key is accepted. A group whose value is an array renders as a
 * flat list (one level, no header); a group whose value is an object renders
 * its array children as labelled levels, sorted numerically (so Level_10 lands
 * after Level_2).
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
  for (const [groupKey, groupVal] of Object.entries(body)) {
    if (!groupVal || typeof groupVal !== 'object') continue;
    const levels: Array<{ label: string; items: string[] }> = [];
    if (Array.isArray(groupVal)) {
      // Flat group (e.g. an EPA → list of descriptors): one unlabelled level.
      const items = groupVal.filter((x): x is string => typeof x === 'string');
      if (items.length > 0) levels.push({ label: '', items });
    } else {
      // Nested group (e.g. competency → Level_N → list).
      for (const [levelKey, levelVal] of Object.entries(
        groupVal as Record<string, unknown>,
      )) {
        if (!Array.isArray(levelVal)) continue;
        const items = levelVal.filter((x): x is string => typeof x === 'string');
        levels.push({ label: prettify(levelKey), items });
      }
      // Sort by the trailing number in `Level_N`.
      levels.sort(
        (a, b) =>
          (parseInt(a.label.replace(/\D+/g, ''), 10) || 0) -
          (parseInt(b.label.replace(/\D+/g, ''), 10) || 0),
      );
    }
    if (levels.length > 0) {
      competencies.push({ name: prettify(groupKey), levels });
    }
  }
  if (competencies.length === 0) return null;
  return { title: prettify(topKey), competencies };
}

function prettify(key: string): string {
  return key
    .replace(/^(?:ACGME_Milestones_|Core_EPAs_|Milestones_)/i, '')
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
            <div key={l.label || c.name} style={{ paddingLeft: 12 }}>
              {l.label ? <Text weight="bold">{l.label}</Text> : null}
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
