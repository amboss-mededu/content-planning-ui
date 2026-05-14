'use client';

import { Badge, Modal, Stack, Text } from '@amboss/design-system';
import type { CSSProperties } from 'react';
import type { ArticleSourceRecord, PredatoryJournalRisk } from '@/lib/pb/types';

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

export function ArticleSourcesDrawer({
  articleTitle,
  sources,
  onClose,
}: {
  articleTitle: string | null;
  sources: ArticleSourceRecord[];
  onClose: () => void;
}) {
  const header = articleTitle ?? 'Article sources';
  const subHeader =
    sources.length === 1 ? '1 source' : `${sources.length.toLocaleString()} sources`;

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
        {sources.length === 0 ? (
          <Stack space="s">
            <Text>No sources attached yet.</Text>
            <Text size="s" color="secondary">
              The literature-search action will be wired up in a follow-up. For now
              sources can be inserted directly via the PocketBase admin UI keyed by this
              article's record id.
            </Text>
          </Stack>
        ) : (
          <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 50 }}>Use</th>
                  <th style={{ ...thStyle, width: 60 }}>Rank</th>
                  <th style={thStyle}>Title</th>
                  <th style={{ ...thStyle, width: 130 }}>Type</th>
                  <th style={thStyle}>Journal</th>
                  <th style={{ ...thStyle, width: 110 }}>Risk</th>
                  <th style={thStyle}>Justification</th>
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
                      <Text size="s">{s.justification ?? '—'}</Text>
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
        )}
      </Modal.Stack>
    </Modal>
  );
}
