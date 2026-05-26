'use client';

import { Badge, Inline, Modal, Stack, Tabs, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CodeRunMetadata } from '@/lib/data/code-run-metadata';
import type { Code } from '@/lib/types';
import type { ProviderId } from '@/lib/workflows/lib/llm';
import { MissingKeyModal } from '../[specialty]/pipeline/_components/missing-key-modal';
import {
  backupModelKey,
  DEFAULT_BACKUP_MODEL,
  readSpec,
  readSpecForStage,
} from '../[specialty]/pipeline/_components/model-selection-storage';
import { CoverageBadge, DepthBadge } from './suggestion-badge';

// The on-disk shape of these JSON columns is richer than the Zod type
// suggests (passthrough preserves the full object). We cast through these
// runtime types when rendering.
type CoveredSection = {
  articleTitle?: string;
  articleId?: string;
  sections?:
    | Record<string, string>
    | Array<{ sectionTitle?: string; sectionId?: string }>;
};

type SectionUpdate = {
  articleTitle?: string;
  articleId?: string;
  sections?: Array<{
    sectionTitle?: string;
    sectionId?: string;
    exists?: boolean;
    changes?: string;
    importance?: number;
  }>;
};

type NewArticleSuggestion = {
  articleTitle?: string;
  importance?: number;
};

function flattenSections(
  block: CoveredSection['sections'],
): Array<{ title: string; id: string }> {
  if (!block) return [];
  if (Array.isArray(block)) {
    return block
      .map((s) => ({ title: s.sectionTitle ?? '(unnamed)', id: s.sectionId ?? '' }))
      .filter((s) => s.title || s.id);
  }
  return Object.entries(block).map(([title, id]) => ({ title, id }));
}

/**
 * Which tab the modal should open on. Lets callers (the table cells) deep-link
 * into the relevant section without the user having to click around.
 * `coverage-articles` is the default.
 */
export type DetailTarget =
  | 'coverage-articles'
  | 'coverage-notes'
  | 'suggestion-improvements'
  | 'suggestion-updates'
  | 'suggestion-new-articles'
  | 'metadata';

const TAB_ORDER: DetailTarget[] = [
  'coverage-articles',
  'coverage-notes',
  'suggestion-improvements',
  'suggestion-updates',
  'suggestion-new-articles',
  'metadata',
];

function targetToIndex(target: DetailTarget | undefined): number {
  if (!target) return 0;
  const i = TAB_ORDER.indexOf(target);
  return i === -1 ? 0 : i;
}

export function CodeDetailModal({
  row,
  target,
  specialtySlug,
  canEdit,
  lockStatus,
  supportReady = true,
  inFlight,
  onClose,
}: {
  row: Code | null;
  target?: DetailTarget;
  specialtySlug: string;
  canEdit: boolean;
  lockStatus: string | null;
  supportReady?: boolean;
  inFlight: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(targetToIndex(target));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);
  const [metadata, setMetadata] = useState<CodeRunMetadata | null>(null);
  const [metadataState, setMetadataState] = useState<
    'idle' | 'loading' | 'loaded' | 'missing' | 'error'
  >('idle');
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [fullRow, setFullRow] = useState<Code | null>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'loaded' | 'error'>(
    'idle',
  );
  const [detailError, setDetailError] = useState<string | null>(null);

  // The modal stays mounted across opens (row toggles between null and a
  // value), so re-align the tab whenever the caller's target/row changes.
  // Manual user clicks aren't overridden until the next open. Errors and
  // submit state also reset so a previous row's failure doesn't leak.
  const rowKey = row?.code;
  useEffect(() => {
    // rowKey is read here so a row change with an unchanged target still fires
    void rowKey;
    setActiveTab(targetToIndex(target));
    setError(null);
    setSubmitting(false);
    setMetadata(null);
    setMetadataState('idle');
    setMetadataError(null);
    setFullRow(null);
    setDetailState(rowKey ? 'loading' : 'idle');
    setDetailError(null);
  }, [target, rowKey]);

  useEffect(() => {
    if (!rowKey) return;
    let cancelled = false;
    setDetailState('loading');
    setDetailError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/codes/${encodeURIComponent(specialtySlug)}/${encodeURIComponent(rowKey)}`,
          { cache: 'no-store' },
        );
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setDetailError(body?.error ?? `HTTP ${res.status}`);
          setDetailState('error');
          return;
        }
        const json = (await res.json()) as Code;
        if (cancelled) return;
        setFullRow(json);
        setDetailState('loaded');
      } catch (e) {
        if (cancelled) return;
        setDetailError(e instanceof Error ? e.message : String(e));
        setDetailState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rowKey, specialtySlug]);

  // Lazy-load metadata only when the user opens that tab. We deliberately
  // exclude `metadataState` from the deps: setting it to 'loading' inside the
  // effect would otherwise re-trigger the effect, and the previous run's
  // cleanup would flip `cancelled = true` on the in-flight fetch — leaving
  // state stuck at 'loading'. Re-runs on row/tab change cancel cleanly.
  useEffect(() => {
    if (activeTab !== 5 || !rowKey) return;
    let cancelled = false;
    setMetadataState('loading');
    setMetadataError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/codes/${encodeURIComponent(specialtySlug)}/${encodeURIComponent(rowKey)}/run-metadata`,
        );
        if (cancelled) return;
        if (res.status === 404) {
          setMetadataState('missing');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setMetadataError(body?.error ?? `HTTP ${res.status}`);
          setMetadataState('error');
          return;
        }
        const json = (await res.json()) as CodeRunMetadata;
        if (cancelled) return;
        setMetadata(json);
        setMetadataState('loaded');
      } catch (e) {
        if (cancelled) return;
        setMetadataError(e instanceof Error ? e.message : String(e));
        setMetadataState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, rowKey, specialtySlug]);

  if (!row) return null;

  // Map/Remap action wired into the modal footer. Mirrors the old in-table
  // RowActions: unmapped rows can always be mapped; remap of an already-
  // mapped row requires the consolidation gate to be open. While the row is
  // currently in flight from an active map_codes run, the action is locked.
  const detailRow = fullRow ?? row;
  const detailLoading = detailState === 'loading';
  const detailFailed = detailState === 'error';

  const isUnmapped = !((detailRow.mappedAt ?? 0) > 0);
  const actionEnabled =
    supportReady && !inFlight && !submitting && (isUnmapped || canEdit);
  const actionLabel = inFlight
    ? 'Mapping…'
    : !supportReady
      ? 'Loading…'
      : submitting
        ? isUnmapped
          ? 'Mapping…'
          : 'Remapping…'
        : isUnmapped
          ? 'Map'
          : 'Remap';
  const lockReason =
    supportReady && !canEdit && !isUnmapped
      ? `Consolidation is active${lockStatus ? ` (${lockStatus})` : ''} — reset to re-enable`
      : null;

  const runMap = async () => {
    if (!actionEnabled) return;
    if (!isUnmapped) {
      const ok = window.confirm(
        `Clear the current mapping for "${detailRow.code}" and re-run? The existing coverage, suggestions, and metadata will be overwritten.`,
      );
      if (!ok) return;
    }
    const primaryModel = readSpecForStage(specialtySlug, 'map_codes');
    if (!primaryModel) {
      setError(
        'No primary model configured for Map codes. Open the gear icon on the Map codes card to pick one.',
      );
      return;
    }
    const backupModel = readSpec(backupModelKey(specialtySlug)) ?? DEFAULT_BACKUP_MODEL;
    setSubmitting(true);
    setError(null);
    try {
      const url = isUnmapped ? '/api/workflows/map-codes' : '/api/workflows/remap-code';
      const body = isUnmapped
        ? {
            specialtySlug,
            codes: [detailRow.code],
            checkAgainstLibrary: true,
            primaryModel,
            backupModel,
          }
        : {
            specialtySlug,
            code: detailRow.code,
            checkAgainstLibrary: true,
            primaryModel,
            backupModel,
          };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resBody = await res.json().catch(() => ({}));
        if (
          res.status === 409 &&
          resBody?.code === 'MISSING_API_KEY' &&
          (resBody.provider === 'google' ||
            resBody.provider === 'anthropic' ||
            resBody.provider === 'openai')
        ) {
          setMissingKey(resBody.provider);
          return;
        }
        setError(resBody?.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const covered = (detailRow.articlesWhereCoverageIs ??
    []) as unknown as CoveredSection[];
  const updates = (detailRow.existingArticleUpdates ?? []) as unknown as SectionUpdate[];
  const newArticles = (detailRow.newArticlesNeeded ??
    []) as unknown as NewArticleSuggestion[];
  const inAmboss = detailRow.isInAMBOSS;
  const specialty = detailRow.specialty ?? '';
  const category = detailRow.category ?? '';

  return (
    <Modal
      header={detailRow.description ?? detailRow.code}
      subHeader={detailRow.description ? detailRow.code : undefined}
      size="l"
      isDismissible
      actionButton={{
        text: actionLabel,
        disabled: !actionEnabled,
        loading: submitting,
      }}
      secondaryButton={{ text: 'Close' }}
      onAction={(action) => {
        if (action === 'cancel') onClose();
        else if (action === 'action') runMap();
      }}
    >
      <Modal.Stack>
        <Stack space="m">
          <Inline space="s" vAlignItems="center">
            {specialty ? (
              <Text size="s" color="secondary">
                <Text as="span" size="s" weight="bold">
                  Specialty:
                </Text>{' '}
                {specialty}
              </Text>
            ) : null}
            {category ? (
              <Text size="s" color="secondary">
                <Text as="span" size="s" weight="bold">
                  Category:
                </Text>{' '}
                {category}
              </Text>
            ) : null}
          </Inline>

          <Inline space="s" vAlignItems="center">
            {inAmboss === true ? (
              <Badge text="In AMBOSS" color="green" />
            ) : inAmboss === false ? (
              <Badge text="Not in AMBOSS" color="red" />
            ) : (
              <Badge text="Unmapped" color="gray" />
            )}
            {detailRow.coverageLevel ? (
              <CoverageBadge level={detailRow.coverageLevel} />
            ) : null}
            {typeof detailRow.depthOfCoverage === 'number' ? (
              <DepthBadge
                depth={detailRow.depthOfCoverage}
                level={detailRow.coverageLevel}
              />
            ) : null}
          </Inline>

          {error ? (
            <Text size="s" color="error">
              {error}
            </Text>
          ) : null}
          {lockReason && !error ? (
            <Text size="s" color="secondary">
              {lockReason}
            </Text>
          ) : null}
          {detailFailed ? (
            <Text size="s" color="error">
              {detailError ?? 'Failed to load code details.'}
            </Text>
          ) : null}

          <Tabs
            aria-label="Code detail sections"
            tabPanelId="code-detail-panel"
            activeTab={activeTab}
            onTabSelect={setActiveTab}
            tabs={[
              { label: 'Coverage' },
              { label: 'Coverage Notes & Gaps' },
              { label: 'Improvements' },
              { label: 'Article Updates' },
              { label: 'New Articles' },
              { label: 'Metadata' },
            ]}
          >
            <div>
              {detailLoading && activeTab !== 5 ? (
                <Text size="s" color="tertiary">
                  Loading code details…
                </Text>
              ) : activeTab === 0 ? (
                <CoverageArticlesPanel covered={covered} />
              ) : activeTab === 1 ? (
                <CoverageNotesPanel
                  notes={detailRow.notes ?? null}
                  gaps={detailRow.gaps ?? null}
                />
              ) : activeTab === 2 ? (
                <SuggestionImprovementsPanel
                  improvements={detailRow.improvements ?? null}
                />
              ) : activeTab === 3 ? (
                <SuggestionUpdatesPanel updates={updates} />
              ) : activeTab === 4 ? (
                <SuggestionNewArticlesPanel newArticles={newArticles} />
              ) : (
                <MetadataPanel
                  state={metadataState}
                  error={metadataError}
                  metadata={metadata}
                />
              )}
            </div>
          </Tabs>
        </Stack>
      </Modal.Stack>
      <MissingKeyModal
        open={missingKey !== null}
        provider={missingKey}
        onClose={() => setMissingKey(null)}
      />
    </Modal>
  );
}

function CoverageArticlesPanel({ covered }: { covered: CoveredSection[] }) {
  if (covered.length === 0) {
    return (
      <Text size="s" color="tertiary">
        No covered articles.
      </Text>
    );
  }
  return (
    <Stack space="s">
      {covered.map((art) => {
        const sections = flattenSections(art.sections);
        return (
          <div
            key={art.articleId ?? art.articleTitle ?? 'art'}
            style={{
              borderLeft: '2px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
              paddingLeft: 10,
            }}
          >
            <Inline space="xxs" vAlignItems="center">
              <Text weight="bold">{art.articleTitle ?? '(untitled)'}</Text>
              {art.articleId ? (
                <Text size="s" color="tertiary">
                  {art.articleId}
                </Text>
              ) : null}
            </Inline>
            {sections.length > 0 ? (
              <Stack space="xxs">
                {sections.map((s) => (
                  <Inline key={s.id || s.title} space="xs" vAlignItems="center">
                    <Text size="s">{s.title}</Text>
                    {s.id ? (
                      <Text size="xs" color="tertiary">
                        {s.id}
                      </Text>
                    ) : null}
                  </Inline>
                ))}
              </Stack>
            ) : null}
          </div>
        );
      })}
    </Stack>
  );
}

function CoverageNotesPanel({
  notes,
  gaps,
}: {
  notes: string | null;
  gaps: string | null;
}) {
  if (!notes && !gaps) {
    return (
      <Text size="s" color="tertiary">
        No notes or gaps.
      </Text>
    );
  }
  return (
    <Stack space="m">
      {notes ? (
        <Stack space="xxs">
          <Text size="xs" weight="bold" color="secondary" transform="uppercase">
            Notes
          </Text>
          <Text>{notes}</Text>
        </Stack>
      ) : null}
      {gaps ? (
        <Stack space="xxs">
          <Text size="xs" weight="bold" color="secondary" transform="uppercase">
            Gaps
          </Text>
          <Text>{gaps}</Text>
        </Stack>
      ) : null}
    </Stack>
  );
}

function SuggestionUpdatesPanel({ updates }: { updates: SectionUpdate[] }) {
  if (updates.length === 0) {
    return (
      <Text size="s" color="tertiary">
        No existing article updates.
      </Text>
    );
  }
  return (
    <Stack space="s">
      {updates.map((upd) => (
        <div
          key={upd.articleId ?? upd.articleTitle ?? 'upd'}
          style={{
            borderLeft: '2px solid rgb(217, 119, 6)',
            paddingLeft: 10,
          }}
        >
          <Inline space="xxs" vAlignItems="center">
            <Text weight="bold">{upd.articleTitle ?? '(untitled)'}</Text>
            {upd.articleId ? (
              <Text size="s" color="tertiary">
                {upd.articleId}
              </Text>
            ) : null}
          </Inline>
          <Stack space="xs">
            {(upd.sections ?? []).map((s) => (
              <Stack key={s.sectionId ?? s.sectionTitle ?? 'sec'} space="xxs">
                <Inline space="xxs" vAlignItems="center">
                  <Text size="s" weight="bold">
                    {s.sectionTitle ?? '(untitled section)'}
                  </Text>
                  {s.exists ? (
                    <Badge text="Section update" color="blue" />
                  ) : (
                    <Badge text="New section" color="green" />
                  )}
                  {typeof s.importance === 'number' ? (
                    <Badge text={`importance ${s.importance}/5`} color="yellow" />
                  ) : null}
                  {s.sectionId ? (
                    <Text size="xs" color="tertiary">
                      {s.sectionId}
                    </Text>
                  ) : null}
                </Inline>
                {s.changes ? <Text size="s">{s.changes}</Text> : null}
              </Stack>
            ))}
          </Stack>
        </div>
      ))}
    </Stack>
  );
}

function SuggestionNewArticlesPanel({
  newArticles,
}: {
  newArticles: NewArticleSuggestion[];
}) {
  if (newArticles.length === 0) {
    return (
      <Text size="s" color="tertiary">
        No new articles needed.
      </Text>
    );
  }
  return (
    <Stack space="xs">
      {newArticles.map((a) => (
        <Inline key={a.articleTitle ?? 'new'} space="xxs" vAlignItems="center">
          <Text weight="bold">{a.articleTitle ?? '(untitled)'}</Text>
          {typeof a.importance === 'number' ? (
            <Badge text={`importance ${a.importance}/5`} color="yellow" />
          ) : null}
        </Inline>
      ))}
    </Stack>
  );
}

function SuggestionImprovementsPanel({ improvements }: { improvements: string | null }) {
  if (!improvements) {
    return (
      <Text size="s" color="tertiary">
        No improvements suggested.
      </Text>
    );
  }
  return <Text>{improvements}</Text>;
}

function formatUsd(n: number | null): string {
  if (n === null) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function formatTokens(n: number): string {
  if (n === 0) return '—';
  return n.toLocaleString();
}

function MetadataPanel({
  state,
  error,
  metadata,
}: {
  state: 'idle' | 'loading' | 'loaded' | 'missing' | 'error';
  error: string | null;
  metadata: CodeRunMetadata | null;
}) {
  if (state === 'loading' || state === 'idle') {
    return (
      <Text size="s" color="tertiary">
        Loading run metadata…
      </Text>
    );
  }
  if (state === 'missing') {
    return (
      <Text size="s" color="tertiary">
        No mapping run has been recorded for this code yet.
      </Text>
    );
  }
  if (state === 'error' || !metadata) {
    return (
      <Text size="s" color="error">
        {error ?? 'Failed to load metadata.'}
      </Text>
    );
  }

  const { totals, attempts, toolBreakdown, finalModel, runStartedAt, stageStatus } =
    metadata;

  return (
    <Stack space="m">
      <Stack space="xxs">
        <Text size="xs" weight="bold" color="secondary" transform="uppercase">
          Run summary
        </Text>
        <Inline space="xs" vAlignItems="center">
          <Badge text={stageStatus ?? 'unknown'} color="gray" />
          {finalModel ? <Badge text={finalModel} color="blue" /> : null}
          <Text size="s" color="tertiary">
            Started {new Date(runStartedAt).toLocaleString()}
          </Text>
        </Inline>
      </Stack>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
        }}
      >
        <MetricCell label="Total cost" value={formatUsd(totals.costUsd)} />
        <MetricCell label="Wall time" value={formatDuration(totals.durationMs)} />
        <MetricCell label="MCP calls" value={String(totals.mcpToolCalls)} />
        <MetricCell label="Input tokens" value={formatTokens(totals.inputTokens)} />
        <MetricCell label="Output tokens" value={formatTokens(totals.outputTokens)} />
        <MetricCell
          label="Reasoning tokens"
          value={formatTokens(totals.reasoningTokens)}
        />
      </div>

      {toolBreakdown.length > 0 ? (
        <Stack space="xxs">
          <Text size="xs" weight="bold" color="secondary" transform="uppercase">
            MCP tool breakdown
          </Text>
          <Inline space="xs" vAlignItems="center">
            {toolBreakdown.map((t) => (
              <Badge key={t.name} text={`${t.name} ×${t.count}`} color="purple" />
            ))}
          </Inline>
        </Stack>
      ) : null}

      <Stack space="xxs">
        <Text size="xs" weight="bold" color="secondary" transform="uppercase">
          Attempts ({attempts.length})
        </Text>
        {attempts.length === 0 ? (
          <Text size="s" color="tertiary">
            No attempt events recorded.
          </Text>
        ) : (
          <Stack space="xs">
            {attempts.map((a, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: events have no stable id and createdAt may collide for fast attempts
                key={`${a.createdAt}-${i}`}
                style={{
                  borderLeft: `2px solid ${
                    a.level === 'error'
                      ? 'rgb(220, 38, 38)'
                      : a.level === 'warn'
                        ? 'rgb(217, 119, 6)'
                        : 'var(--ads-c-divider, rgba(0,0,0,0.15))'
                  }`,
                  paddingLeft: 10,
                }}
              >
                <Inline space="xs" vAlignItems="center">
                  <Text size="s" weight="bold">
                    {a.message}
                  </Text>
                  {a.model ? (
                    <Text size="xs" color="tertiary">
                      {a.model}
                    </Text>
                  ) : null}
                </Inline>
                <Inline space="s" vAlignItems="center">
                  {typeof a.costUsd === 'number' ? (
                    <Text size="xs" color="secondary">
                      {formatUsd(a.costUsd)}
                    </Text>
                  ) : null}
                  {a.durationMs ? (
                    <Text size="xs" color="secondary">
                      {formatDuration(a.durationMs)}
                    </Text>
                  ) : null}
                  {typeof a.mcpToolCalls === 'number' && a.mcpToolCalls > 0 ? (
                    <Text size="xs" color="secondary">
                      {a.mcpToolCalls} MCP calls
                    </Text>
                  ) : null}
                  {a.inputTokens || a.outputTokens ? (
                    <Text size="xs" color="tertiary">
                      {formatTokens(a.inputTokens ?? 0)} in /{' '}
                      {formatTokens(a.outputTokens ?? 0)} out
                    </Text>
                  ) : null}
                  {a.invalidIds && a.invalidIds.length > 0 ? (
                    <Badge text={`${a.invalidIds.length} invalid IDs`} color="yellow" />
                  ) : null}
                </Inline>
              </div>
            ))}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.1))',
        borderRadius: 6,
        padding: '8px 10px',
      }}
    >
      <Text size="xs" color="tertiary">
        {label}
      </Text>
      <Text size="m" weight="bold">
        {value}
      </Text>
    </div>
  );
}
