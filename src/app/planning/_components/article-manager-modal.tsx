'use client';

import { Badge, Inline, Modal, Stack, Text } from '@amboss/design-system';
import type { CSSProperties } from 'react';
import type {
  ArticleBacklogStatus,
  ArticleSourceRecord,
  PredatoryJournalRisk,
} from '@/lib/pb/types';
import {
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_OPTIONS,
  statusToStepValue,
} from './backlog-constants';
import type { BacklogRow } from './backlog-view';

const SOURCE_TYPE_LABEL: Record<string, string> = {
  guideline: 'Guideline',
  systematic_review: 'Systematic review',
  clinical_review: 'Clinical review',
  meta_analysis: 'Meta-analysis',
  case_report: 'Case report',
  vet_content: 'Vet content',
  non_english: 'Non-English',
  other: 'Other',
};

const RISK_COLOR: Record<
  PredatoryJournalRisk,
  'gray' | 'green' | 'yellow' | 'red' | 'purple'
> = {
  none: 'green',
  low: 'gray',
  medium: 'yellow',
  high: 'red',
  predatory: 'purple',
};

// Concise per-step copy for the steps we haven't built UIs for yet. The
// stepper still lets editors jump to these steps; the body just explains
// what happens off-platform so they aren't staring at an empty pane.
const STEP_COPY: Record<ArticleBacklogStatus, string> = {
  unassigned: 'This article is waiting for the first literature search.',
  'waiting-for-sources':
    'No sources fetched yet. Run the Literature search card on the Pipeline tab to fetch and rank PubMed candidates for every article in this state.',
  'sources-searched':
    'PubMed ranked these sources for this article. Review the list and move to "Sources approved" once you\'re satisfied.',
  'sources-approved':
    'The source list is locked in. Next: upload the source PDFs to Cortex CMS, then mark this article as ready for the LLM draft.',
  'ready-for-llm-draft':
    'Sources are in Cortex. Trigger article-draft generation when ready (coming in a follow-up). Once the draft is back, move this article to "Ready for editing".',
  'ready-for-editing':
    'The LLM draft is in Cortex CMS. Open it there to start editing. When you begin, move this article to "Editing in progress".',
  'editing-in-progress':
    'Editing is happening in Cortex CMS. When the article is ready for a final pass, move it to "Ready to publish".',
  'ready-to-publish':
    'Final review checklist (coming in a follow-up). When done, mark this article as "Published".',
  published: 'This article has been published.',
};

// --- Source table styles ----------------------------------------------------

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9em',
};
const thStyle: CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid rgb(220, 220, 225)',
  padding: '8px 6px',
  fontWeight: 600,
  color: 'rgb(70, 70, 80)',
  background: 'rgb(248, 248, 250)',
  position: 'sticky',
  top: 0,
};
const tdStyle: CSSProperties = {
  borderBottom: '1px solid rgb(238, 238, 242)',
  padding: '8px 6px',
  verticalAlign: 'top',
};

function SourcesTable({ sources }: { sources: ArticleSourceRecord[] }) {
  if (sources.length === 0) {
    return (
      <Stack space="s">
        <Text>No sources attached yet.</Text>
        <Text size="s" color="secondary">
          Run the Literature search card on the Pipeline tab to fetch PubMed candidates
          for every article still waiting for sources.
        </Text>
      </Stack>
    );
  }
  return (
    <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 50 }}>Use</th>
            <th style={{ ...thStyle, width: 60 }}>Rank</th>
            <th style={thStyle}>Title</th>
            <th style={{ ...thStyle, width: 130 }}>Type</th>
            <th style={thStyle}>Journal</th>
            <th style={{ ...thStyle, width: 110 }}>Risk</th>
            <th style={{ ...thStyle, width: 160 }}>DOI</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td style={{ ...tdStyle, textAlign: 'center' }}>
                {s.useFlag ? (
                  <Text as="span" size="s" weight="bold">
                    ✓
                  </Text>
                ) : (
                  <Text as="span" size="s" color="secondary">
                    ✗
                  </Text>
                )}
              </td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{s.rank ?? '—'}</td>
              <td style={tdStyle}>
                <Text weight="bold">{s.title}</Text>
                {s.llmSummary ? (
                  <Text size="xs" color="secondary">
                    {s.llmSummary}
                  </Text>
                ) : null}
              </td>
              <td style={tdStyle}>
                {s.sourceType ? (
                  <Badge
                    text={SOURCE_TYPE_LABEL[s.sourceType] ?? s.sourceType}
                    color="blue"
                  />
                ) : (
                  '—'
                )}
              </td>
              <td style={tdStyle}>
                {s.journal ?? '—'}
                {s.journalNlm ? (
                  <Text size="xs" color="secondary">
                    {s.journalNlm}
                  </Text>
                ) : null}
              </td>
              <td style={tdStyle}>
                {s.predatoryJournalRisk ? (
                  <Badge
                    text={s.predatoryJournalRisk}
                    color={RISK_COLOR[s.predatoryJournalRisk]}
                  />
                ) : (
                  '—'
                )}
              </td>
              <td style={tdStyle}>
                {s.doi ? (
                  <a
                    href={`https://doi.org/${s.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ wordBreak: 'break-all' }}
                  >
                    {s.doi}
                  </a>
                ) : s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ wordBreak: 'break-all' }}
                  >
                    {s.url}
                  </a>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Stepper ----------------------------------------------------------------

type StepState = 'completed' | 'current' | 'upcoming';

function stepStateFor(stepIndex: number, currentIndex: number): StepState {
  if (stepIndex < currentIndex) return 'completed';
  if (stepIndex === currentIndex) return 'current';
  return 'upcoming';
}

const stepButtonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid rgb(210, 210, 215)',
  borderRadius: 999,
  padding: '4px 10px',
  background: 'white',
  color: 'rgb(40, 40, 50)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.85em',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
};

const circleBase: CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.75em',
  fontWeight: 600,
};

function Stepper({
  current,
  onPick,
}: {
  current: ArticleBacklogStatus;
  onPick: (next: ArticleBacklogStatus) => void;
}) {
  const stepValue = statusToStepValue(current);
  const currentIndex = STATUS_OPTIONS.findIndex((s) => s.value === stepValue);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        rowGap: 8,
        alignItems: 'center',
      }}
    >
      {STATUS_OPTIONS.map((step, i) => {
        const state = stepStateFor(i, currentIndex < 0 ? 0 : currentIndex);
        const isCurrent = state === 'current';
        const isCompleted = state === 'completed';
        const buttonStyle: CSSProperties = {
          ...stepButtonBase,
          background: isCurrent ? 'rgb(255, 248, 230)' : 'white',
          borderColor: isCurrent
            ? 'rgb(217, 119, 6)'
            : isCompleted
              ? 'rgb(34, 139, 80)'
              : 'rgb(210, 210, 215)',
          color: isCurrent
            ? 'rgb(120, 70, 0)'
            : isCompleted
              ? 'rgb(15, 95, 50)'
              : 'rgb(90, 90, 100)',
          fontWeight: isCurrent ? 600 : 400,
        };
        const circleStyle: CSSProperties = {
          ...circleBase,
          background: isCompleted
            ? 'rgb(34, 139, 80)'
            : isCurrent
              ? 'rgb(217, 119, 6)'
              : 'rgb(230, 230, 235)',
          color: isCompleted || isCurrent ? 'white' : 'rgb(90, 90, 100)',
        };
        return (
          <button
            key={step.value}
            type="button"
            onClick={() => onPick(step.value)}
            style={buttonStyle}
            aria-current={isCurrent ? 'step' : undefined}
            title={step.label}
          >
            <span style={circleStyle}>{isCompleted ? '✓' : i + 1}</span>
            <span>{step.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- Step body --------------------------------------------------------------

function StepBody({
  status,
  sources,
}: {
  status: ArticleBacklogStatus;
  sources: ArticleSourceRecord[];
}) {
  const copy = STEP_COPY[status];
  if (status === 'sources-searched' || status === 'sources-approved') {
    return (
      <Stack space="m">
        <Text color="secondary">{copy}</Text>
        {status === 'sources-approved' ? (
          <Inline space="s" vAlignItems="center">
            <Badge text="Sources approved" color="green" />
            <Text size="s" color="secondary">
              {sources.length} source{sources.length === 1 ? '' : 's'} locked in
            </Text>
          </Inline>
        ) : null}
        <SourcesTable sources={sources} />
      </Stack>
    );
  }
  return (
    <Stack space="s">
      <Text>{copy}</Text>
    </Stack>
  );
}

// --- Modal ------------------------------------------------------------------

export function ArticleManagerModal({
  article,
  currentStatus,
  sources,
  onStatusChange,
  onClose,
}: {
  article: BacklogRow;
  currentStatus: ArticleBacklogStatus;
  sources: ArticleSourceRecord[];
  onStatusChange: (next: ArticleBacklogStatus) => void | Promise<void>;
  onClose: () => void;
}) {
  const header = article.articleTitle ?? 'Manage article';
  const subHeader = `Currently: ${STATUS_LABEL[currentStatus]}`;
  return (
    <Modal
      header={header}
      subHeader={subHeader}
      size="l"
      isDismissible
      secondaryButton={{ text: 'Close' }}
      onAction={(action) => {
        if (action === 'cancel') onClose();
      }}
    >
      <Modal.Stack>
        <Stack space="m">
          <Inline space="s" vAlignItems="center">
            <Badge
              text={STATUS_LABEL[currentStatus]}
              color={STATUS_COLOR[currentStatus]}
            />
          </Inline>
          <Stepper current={currentStatus} onPick={onStatusChange} />
          <StepBody status={currentStatus} sources={sources} />
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
