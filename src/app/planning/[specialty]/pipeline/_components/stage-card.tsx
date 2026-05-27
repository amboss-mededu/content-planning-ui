'use client';

import {
  Badge,
  Box,
  Button,
  Card,
  CardBox,
  Divider,
  H5,
  Inline,
  Stack,
  Text,
} from '@amboss/design-system';
import { useEffect, useRef, useState } from 'react';
import type {
  MapCodesHistory,
  PipelineEventRow,
  PipelineRunRow,
  PipelineStageRow,
} from '@/lib/data/pipeline';
import type { PipelineCardState } from '@/lib/pipeline-stage-state';
import type { StageName } from '@/lib/workflows/lib/db-writes';
import {
  type CodeSource,
  normalizeInputs,
  sourceLabel,
} from '@/lib/workflows/lib/sources';
import { ApproveButton } from './approve-button';
import { CancelButton } from './cancel-button';
import { ModelSettingsPopover } from './model-settings-popover';
import { StageStateControl } from './stage-state-control';

/**
 * Persist a boolean flag in localStorage. Defaults to `false` on first paint
 * (so SSR matches), then snaps to the stored value once mounted. Writes back
 * on every change. Scoped per-key so each card can have its own setting.
 */
function useStoredBoolean(
  key: string,
  fallback: boolean,
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(fallback);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === '1') setValue(true);
      else if (raw === '0') setValue(false);
    } catch {}
    setHydrated(true);
  }, [key]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, value ? '1' : '0');
    } catch {}
  }, [key, value, hydrated]);
  return [value, setValue];
}

type StageStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'approved'
  | 'completed'
  | 'failed'
  | 'skipped';

const STATUS_COLOR: Record<StageStatus, 'gray' | 'blue' | 'yellow' | 'green' | 'red'> = {
  pending: 'gray',
  running: 'blue',
  awaiting_approval: 'yellow',
  approved: 'green',
  completed: 'green',
  failed: 'red',
  skipped: 'gray',
};

const STATUS_LABEL: Record<StageStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
};

function summaryLine(summary: unknown): string | null {
  if (!summary || typeof summary !== 'object') return null;
  const s = summary as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof s.extracted === 'number') parts.push(`${s.extracted} extracted`);
  if (typeof s.modules === 'number') parts.push(`${s.modules} modules`);
  if (typeof s.pdfs === 'number') parts.push(`${s.pdfs} PDFs`);
  if (typeof s.chars === 'number') parts.push(`${s.chars} chars`);
  if (typeof s.inputs === 'number') parts.push(`${s.inputs} inputs`);
  if (typeof s.mapped === 'number') parts.push(`${s.mapped} mapped`);
  if (typeof s.escalations === 'number' && s.escalations > 0)
    parts.push(`${s.escalations} escalated`);
  if (typeof s.invalidIdsRemaining === 'number' && s.invalidIdsRemaining > 0)
    parts.push(`${s.invalidIdsRemaining} unresolved`);
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

function formatMs(ms: unknown): string {
  if (typeof ms !== 'number' || ms <= 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

function formatTokens(n: unknown): string | null {
  if (typeof n !== 'number' || n <= 0) return null;
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

function formatCost(usd: unknown): string | null {
  if (typeof usd !== 'number') return null;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function metricsLine(summary: unknown): string | null {
  if (!summary || typeof summary !== 'object') return null;
  const s = summary as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof s.apiCalls === 'number') parts.push(`${s.apiCalls} API calls`);
  if (typeof s.durationMs === 'number') parts.push(formatMs(s.durationMs));
  const cost = formatCost(s.costUsd);
  if (cost) parts.push(cost);
  const total =
    (typeof s.inputTokens === 'number' ? s.inputTokens : 0) +
    (typeof s.outputTokens === 'number' ? s.outputTokens : 0) +
    (typeof s.reasoningTokens === 'number' ? s.reasoningTokens : 0);
  const tokens = formatTokens(total);
  if (tokens) parts.push(`${tokens} tokens`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

const LEVEL_ICON: Record<string, string> = {
  info: '•',
  warn: '⚠',
  error: '✕',
};

const LEVEL_COLOR: Record<string, string> = {
  info: 'inherit',
  warn: 'var(--color-yellow-600, #a16207)',
  error: 'var(--color-red-600, #dc2626)',
};

function formatTs(ts: Date | null | undefined): string | null {
  if (!ts) return null;
  return new Date(ts).toLocaleString();
}

/**
 * Browser for a sequence of per-call LLM completions. Each `events` entry has
 * its parsed output stored on `metrics.completion`. Arrows step through; a
 * counter shows N of M. Used for both Phase 1 (few) and Phase 2 (many) calls.
 */
function CompletionBrowser({
  events,
  renderLabel,
  renderItem,
  renderRaw,
  emptyLabel,
}: {
  events: PipelineEventRow[];
  renderLabel: (event: PipelineEventRow) => string;
  renderItem: (item: unknown, key: string) => React.ReactNode;
  /** Optional: override the per-event body with a single custom renderer
   *  (e.g. a JSON dump of the full completion). When provided, `renderItem`
   *  is ignored. */
  renderRaw?: (event: PipelineEventRow) => React.ReactNode;
  emptyLabel: string;
}) {
  const [index, setIndex] = useState(0);
  if (events.length === 0) {
    return <Text color="secondary">{emptyLabel}</Text>;
  }
  const clamped = Math.min(Math.max(0, index), events.length - 1);
  const current = events[clamped];
  const metrics = (current.metrics ?? {}) as Record<string, unknown>;
  const completion = Array.isArray(metrics.completion) ? metrics.completion : [];
  return (
    <Stack space="xxs">
      <Inline space="xs" vAlignItems="center">
        <Button
          type="button"
          variant="tertiary"
          disabled={clamped === 0}
          onClick={() => setIndex(clamped - 1)}
        >
          ◀
        </Button>
        <Text color="secondary">
          {clamped + 1} of {events.length}
        </Text>
        <Button
          type="button"
          variant="tertiary"
          disabled={clamped === events.length - 1}
          onClick={() => setIndex(clamped + 1)}
        >
          ▶
        </Button>
      </Inline>
      <Text color="secondary">{renderLabel(current)}</Text>
      <div
        style={{
          maxHeight: 320,
          overflowY: 'auto',
          background: 'var(--color-gray-50, #f8f8f8)',
          border: '1px solid var(--color-gray-200, #e5e5e5)',
          borderRadius: 4,
          padding: 8,
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {renderRaw
          ? renderRaw(current)
          : completion.map((item, i) => renderItem(item, `${current.id}-${i}`))}
      </div>
    </Stack>
  );
}

function CollapsibleSubsection({
  title,
  defaultExpanded = false,
  children,
}: {
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  return (
    <Stack space="xxs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          font: 'inherit',
          color: 'inherit',
        }}
      >
        <span
          aria-hidden
          style={{ display: 'inline-block', width: 16, fontSize: 16, lineHeight: 1 }}
        >
          {open ? '▾' : '▸'}
        </span>
        <Text weight="bold">{title}</Text>
      </button>
      {open ? children : null}
    </Stack>
  );
}

function summaryPairs(summary: unknown): Array<[string, string]> {
  if (!summary || typeof summary !== 'object') return [];
  return Object.entries(summary as Record<string, unknown>).map(([k, v]) => [
    k,
    typeof v === 'object' ? JSON.stringify(v) : String(v),
  ]);
}

/**
 * Sum per-event metrics for a window of map_codes events. Mirrors
 * aggregateStageMetrics in the workflow lib so Overall/per-run views agree
 * with what the workflow itself wrote at run completion.
 */
function aggregateMapEvents(events: PipelineEventRow[]) {
  let apiCalls = 0;
  let computeMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let costUsd = 0;
  let anyCost = false;
  const codes = new Set<string>();
  for (const e of events) {
    const m = (e.metrics ?? {}) as Record<string, unknown>;
    if (typeof m.code === 'string') codes.add(m.code);
    if (typeof m.durationMs === 'number' && m.durationMs > 0) {
      apiCalls += 1;
      computeMs += m.durationMs;
    }
    if (typeof m.inputTokens === 'number') inputTokens += m.inputTokens;
    if (typeof m.outputTokens === 'number') outputTokens += m.outputTokens;
    if (typeof m.reasoningTokens === 'number') reasoningTokens += m.reasoningTokens;
    if (typeof m.costUsd === 'number') {
      costUsd += m.costUsd;
      anyCost = true;
    }
  }
  return {
    apiCalls,
    computeMs,
    inputTokens,
    outputTokens,
    reasoningTokens,
    costUsd: anyCost ? costUsd : null,
    codesMapped: codes.size,
  };
}

/** Specialty-wide "X mapped, Y unmapped" tally for the Map codes card.
 *  Counts come from the codes table, so initial render does not need to
 *  hydrate every mapping event. */
function buildMapCodesSummary(
  mapped: number | undefined,
  unmapped: number | undefined,
): string | null {
  if ((mapped ?? 0) === 0 && (unmapped === undefined || unmapped === 0)) return null;
  const parts: string[] = [];
  parts.push(`${mapped ?? 0} mapped`);
  if (typeof unmapped === 'number') parts.push(`${unmapped} unmapped`);
  return parts.join(', ');
}

function runLabel(run: PipelineRunRow): string {
  const ts = run.startedAt
    ? new Date(run.startedAt).toLocaleString()
    : run.id.slice(0, 8);
  const status = run.status ? ` · ${run.status}` : '';
  return `${ts}${status}`;
}

function MapMetadataBody({
  events,
  run,
}: {
  events: PipelineEventRow[];
  run: PipelineRunRow | null;
}) {
  const totals = aggregateMapEvents(events);
  const rows: Array<[string, string]> = [];
  rows.push(['Codes mapped', String(totals.codesMapped)]);
  rows.push(['API calls', String(totals.apiCalls)]);
  const totalTokens = totals.inputTokens + totals.outputTokens + totals.reasoningTokens;
  if (totalTokens > 0) {
    rows.push(['Tokens', totalTokens.toLocaleString()]);
    if (totals.inputTokens > 0)
      rows.push(['  · input', totals.inputTokens.toLocaleString()]);
    if (totals.outputTokens > 0)
      rows.push(['  · output', totals.outputTokens.toLocaleString()]);
    if (totals.reasoningTokens > 0)
      rows.push(['  · reasoning', totals.reasoningTokens.toLocaleString()]);
  }
  if (totals.costUsd != null) {
    const c = formatCost(totals.costUsd);
    if (c) rows.push(['Cost', c]);
  }
  // Per-run only: duration + run-level scope info.
  if (run) {
    if (run.startedAt && run.finishedAt) {
      const durationMs =
        new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
      if (durationMs > 0) rows.push(['Duration', formatMs(durationMs)]);
    }
    const mf = (run.mappingFilter ?? null) as {
      categories?: string[];
      codes?: string[];
    } | null;
    if (mf?.categories?.length) rows.push(['Categories', mf.categories.join(', ')]);
    if (mf?.codes?.length)
      rows.push([
        'Code filter',
        `${mf.codes.length} code${mf.codes.length === 1 ? '' : 's'}`,
      ]);
    if (run.workflowRunId) rows.push(['Workflow', run.workflowRunId]);
  }
  return (
    <Stack space="xxs">
      {rows.map(([k, v]) => (
        <Text key={k} color="secondary">
          {k}: {v}
        </Text>
      ))}
    </Stack>
  );
}

function MapLogBody({ events }: { events: PipelineEventRow[] }) {
  if (events.length === 0) {
    return <Text color="secondary">No events.</Text>;
  }
  return (
    <div
      style={{
        maxHeight: 320,
        overflowY: 'auto',
        background: 'var(--color-gray-50, #f8f8f8)',
        border: '1px solid var(--color-gray-200, #e5e5e5)',
        borderRadius: 4,
        padding: 8,
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {events.map((e) => {
        const m = (e.metrics ?? {}) as Record<string, unknown>;
        const ts = new Date(e.createdAt).toLocaleTimeString();
        const metaParts: string[] = [];
        if (typeof m.durationMs === 'number') metaParts.push(formatMs(m.durationMs));
        const cost = formatCost(m.costUsd);
        if (cost) metaParts.push(cost);
        const total =
          (typeof m.inputTokens === 'number' ? m.inputTokens : 0) +
          (typeof m.outputTokens === 'number' ? m.outputTokens : 0) +
          (typeof m.reasoningTokens === 'number' ? m.reasoningTokens : 0);
        const tokens = formatTokens(total);
        if (tokens) metaParts.push(`${tokens} tokens`);
        return (
          <div
            key={e.id}
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            <span style={{ color: 'var(--color-gray-500, #737373)' }}>[{ts}]</span>{' '}
            <span style={{ color: LEVEL_COLOR[e.level] ?? 'inherit' }}>
              {LEVEL_ICON[e.level] ?? '•'}
            </span>{' '}
            {e.message}
            {metaParts.length > 0 ? (
              <span style={{ color: 'var(--color-gray-500, #737373)' }}>
                {' '}
                · {metaParts.join(' · ')}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Arrow-navigated browser over `Overall + each run`. Index 0 = Overall (sums
 * across every map_codes run); subsequent indices are individual runs sorted
 * newest-first. The same selection state drives both metadata and log views,
 * but each instance is independent (so you can browse metadata for one run
 * and logs for another if you really want to).
 */
function MapCodesRunBrowser({
  history,
  mode,
}: {
  history: MapCodesHistory;
  mode: 'metadata' | 'logs';
}) {
  const [index, setIndex] = useState(0);
  const total = history.runs.length + 1; // +1 for the Overall index
  const clamped = Math.min(Math.max(0, index), total - 1);
  const isOverall = clamped === 0;
  const run = isOverall ? null : history.runs[clamped - 1];
  const eventsForView = isOverall
    ? history.events
    : run
      ? (history.eventsByRunId?.[run.id] ?? [])
      : [];
  const label = isOverall
    ? `Overall · ${history.runs.length} run${history.runs.length === 1 ? '' : 's'}`
    : run
      ? runLabel(run)
      : '';

  return (
    <Stack space="xs">
      <Inline space="xs" vAlignItems="center">
        <Button
          type="button"
          variant="tertiary"
          disabled={clamped === 0}
          onClick={() => setIndex(clamped - 1)}
        >
          ◀
        </Button>
        <Text color="secondary">
          {label} ({clamped + 1} of {total})
        </Text>
        <Button
          type="button"
          variant="tertiary"
          disabled={clamped === total - 1}
          onClick={() => setIndex(clamped + 1)}
        >
          ▶
        </Button>
      </Inline>
      {mode === 'metadata' ? (
        <MapMetadataBody events={eventsForView} run={run} />
      ) : (
        <MapLogBody events={eventsForView} />
      )}
    </Stack>
  );
}

export function StageCard({
  title,
  description,
  stage,
  specialtySlug,
  stageName,
  runUrls,
  events,
  sources,
  treatAsInProgress,
  continueAction,
  mapCodesHistory,
  unmappedCount,
  mappedCount,
  manualState,
  children,
}: {
  title: string;
  description?: string;
  /** Optional inline start form (or other body content) rendered inside the
   *  expanded card body, below the action buttons. Used by stages whose
   *  trigger lives on the dashboard (e.g. the three consolidate stages). */
  children?: React.ReactNode;
  stage: PipelineStageRow | null;
  specialtySlug: string;
  stageName: StageName;
  runUrls?: unknown;
  events?: PipelineEventRow[];
  sources?: CodeSource[];
  /** True when the stage has produced at least one piece of output. */
  hasOutput?: boolean;
  /** Editor-controlled card state. Workflow status still powers details,
   *  approval/cancel availability, logs, and run metadata. */
  manualState: PipelineCardState;
  /** When the latest run wrapped up (completed / approved) but the
   *  specialty-level work isn't finished — e.g. map_codes ran for a subset
   *  of codes and more remain unmapped — display "In progress" instead of
   *  "Completed". Other statuses (running / awaiting_approval / failed /
   *  pending) are left alone so they remain actionable signals. */
  treatAsInProgress?: boolean;
  /** @deprecated Kept as an ignored prop while call sites are simplified. */
  alwaysShowReset?: boolean;
  /** Opt-in primary CTA for partially-complete stages. Renders an AMBOSS-
   *  green Button with the given label when the latest run is wrapped up
   *  (completed / approved / failed / cancelled) so the user can launch
   *  another pass without scrolling. The handler is fire-and-forget — the
   *  caller is responsible for clearing zombie pipeline runs and revealing
   *  whatever follow-up form is needed. */
  continueAction?: { label: string; onClick: () => void | Promise<void> };
  /** When provided, the Map codes card replaces its per-stage Metadata + Log
   *  sections with arrow-navigated views over every map_codes run for the
   *  specialty (Overall first). Drops the per-code Output section entirely
   *  and removes Started/Finished timestamps. Only meaningful for the
   *  `map_codes` card; ignored for other stages. */
  mapCodesHistory?: MapCodesHistory;
  /** Specialty-level count of codes still unmapped. When passed alongside
   *  `mapCodesHistory`, the Map codes summary line becomes
   *  `X mapped, Y unmapped`, replacing the per-run "X mapped" from
   *  outputSummary and giving the user a true progress signal. */
  unmappedCount?: number;
  mappedCount?: number;
}) {
  const runInputs = normalizeInputs(runUrls);
  const [displayManualState, setDisplayManualState] = useState(manualState);
  useEffect(() => {
    setDisplayManualState(manualState);
  }, [manualState]);
  const rawStatus = (stage?.status ?? 'pending') as StageStatus;
  const status: StageStatus =
    displayManualState === 'skipped'
      ? 'skipped'
      : displayManualState === 'complete'
        ? 'completed'
        : displayManualState === 'in_progress'
          ? 'running'
          : 'pending';
  const useMapHistory = stageName === 'map_codes';
  // Map codes shows a specialty-wide "X mapped, Y unmapped" tally instead of
  // the per-run summary, since the card represents the whole stage and per-run
  // numbers reset every batch. Suppress the metrics line for the same reason —
  // overall API call / token totals live inside the per-run Metadata browser.
  const summary = useMapHistory
    ? buildMapCodesSummary(mappedCount, unmappedCount)
    : summaryLine(stage?.outputSummary);
  const metrics = useMapHistory ? null : metricsLine(stage?.outputSummary);
  const approvable =
    stage?.stage === 'extract_codes' ||
    stage?.stage === 'extract_milestones' ||
    stage?.stage === 'map_codes';
  const isCancellable = rawStatus === 'running' || rawStatus === 'awaiting_approval';
  const inProgressOverride =
    treatAsInProgress === true &&
    displayManualState === 'complete' &&
    status === 'completed';
  const isActuallyRunning = rawStatus === 'running';
  const isInProgress = inProgressOverride || (status === 'running' && !isActuallyRunning);
  const badgeLabel = isActuallyRunning
    ? 'Running'
    : isInProgress
      ? 'In progress'
      : STATUS_LABEL[status];
  const badgeColor = isActuallyRunning || isInProgress ? 'blue' : STATUS_COLOR[status];
  // Continue is only useful when nothing is mid-flight. While running or
  // awaiting_approval the user should drive the run via Cancel / Approve.
  const showContinue =
    continueAction !== undefined &&
    rawStatus !== 'running' &&
    rawStatus !== 'awaiting_approval';
  const [continuing, setContinuing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lazyMapHistory, setLazyMapHistory] = useState<MapCodesHistory | null>(
    mapCodesHistory ?? null,
  );
  const [mapHistoryLoading, setMapHistoryLoading] = useState(false);
  const [mapHistoryError, setMapHistoryError] = useState<string | null>(null);
  const mapHistoryRequested = useRef(mapCodesHistory !== undefined);
  // Card-level collapse — clicking the header hides the body. Persisted per
  // (specialty, stage) so a user's expand/collapse layout survives reloads.
  const [bodyCollapsed, setBodyCollapsed] = useStoredBoolean(
    `pipeline:${specialtySlug}:card-collapsed:${stageName}`,
    false,
  );
  const evs = events ?? [];
  const activeMapHistory = mapCodesHistory ?? lazyMapHistory;
  const hasMapHistory = useMapHistory && (activeMapHistory?.events.length ?? 0) > 0;
  const hasDetails =
    stage !== null &&
    (stage.outputSummary ||
      stage.draftPayload ||
      stage.startedAt ||
      stage.errorMessage ||
      runInputs.length > 0 ||
      evs.length > 0 ||
      hasMapHistory);

  useEffect(() => {
    if (!expanded || !useMapHistory || activeMapHistory || mapHistoryRequested.current) {
      return;
    }
    let cancelled = false;
    mapHistoryRequested.current = true;
    setMapHistoryLoading(true);
    setMapHistoryError(null);
    fetch(`/api/pipeline/${encodeURIComponent(specialtySlug)}/map-codes-history`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        if (!cancelled) setLazyMapHistory(body as MapCodesHistory);
      })
      .catch((err) => {
        if (!cancelled)
          setMapHistoryError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setMapHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeMapHistory, expanded, specialtySlug, useMapHistory]);
  // Only let users collapse cards once the step has actually run — a pending
  // card's body holds the preview / CTA copy that explains what the step does,
  // and hiding that behind a click before anything has happened just makes the
  // page harder to use.
  const isPending = status === 'pending';
  const collapsible = !isPending;
  const showBody = !collapsible || !bodyCollapsed;
  // The model-settings popover lives outside the collapsible header button so
  // its click target isn't swallowed by the card's expand/collapse handler.
  // For stages without a default model (none today — DEFAULT_MODELS covers all
  // catalog stages), the popover would render an empty body; we still mount
  // it so the surface is consistent across cards.
  const headerInner = (
    <Inline space="s" vAlignItems="center">
      <H5 as="h4">{title}</H5>
      <Badge text={badgeLabel} color={badgeColor} />
    </Inline>
  );

  return (
    <div className="card-fill">
      <Card outlined>
        <Box vSpace="m" lSpace="l" rSpace="l">
          <Inline space="s" vAlignItems="center">
            <div style={{ flex: 1, minWidth: 0 }}>
              {collapsible ? (
                <button
                  type="button"
                  onClick={() => setBodyCollapsed(!bodyCollapsed)}
                  aria-expanded={!bodyCollapsed}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    margin: 0,
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    font: 'inherit',
                    color: 'inherit',
                  }}
                >
                  {headerInner}
                </button>
              ) : (
                headerInner
              )}
            </div>
            <ModelSettingsPopover specialtySlug={specialtySlug} stage={stageName} />
          </Inline>
        </Box>
        {showBody && <Divider />}
        {showBody && (
          <CardBox>
            <Stack space="s">
              {description ? <Text color="secondary">{description}</Text> : null}
              {summary ? <Text>{summary}</Text> : null}
              {metrics ? <Text color="secondary">{metrics}</Text> : null}
              {rawStatus === 'failed' && stage?.errorMessage ? (
                <Text color="secondary">{stage.errorMessage}</Text>
              ) : null}
              <Inline space="s" vAlignItems="center">
                {hasDetails ? (
                  <Button variant="tertiary" onClick={() => setExpanded((x) => !x)}>
                    {expanded ? 'Hide details' : 'Show details'}
                  </Button>
                ) : null}
                {rawStatus === 'awaiting_approval' && stage && approvable ? (
                  <ApproveButton
                    runId={stage.runId}
                    specialtySlug={specialtySlug}
                    stage={
                      stage.stage as 'extract_codes' | 'extract_milestones' | 'map_codes'
                    }
                  />
                ) : null}
                {isCancellable && stage ? (
                  <CancelButton
                    runId={stage.runId}
                    specialtySlug={specialtySlug}
                    stage={stageName}
                  />
                ) : null}
                {showContinue && continueAction ? (
                  <Button
                    variant="primary"
                    disabled={continuing}
                    onClick={async () => {
                      setContinuing(true);
                      try {
                        await continueAction.onClick();
                      } finally {
                        setContinuing(false);
                      }
                    }}
                  >
                    {continuing ? 'Working…' : continueAction.label}
                  </Button>
                ) : null}
                <StageStateControl
                  slug={specialtySlug}
                  stageName={stageName}
                  state={displayManualState}
                  onOptimisticStateChange={setDisplayManualState}
                />
              </Inline>
              {children ?? null}
              {expanded && stage ? (
                <Stack space="xs">
                  {!useMapHistory && formatTs(stage.startedAt) ? (
                    <Text color="secondary">Started: {formatTs(stage.startedAt)}</Text>
                  ) : null}
                  {!useMapHistory && formatTs(stage.finishedAt) ? (
                    <Text color="secondary">Finished: {formatTs(stage.finishedAt)}</Text>
                  ) : null}
                  {formatTs(stage.approvedAt) ? (
                    <Text color="secondary">
                      Approved: {formatTs(stage.approvedAt)}
                      {stage.approvedBy ? ` by ${stage.approvedBy}` : ''}
                    </Text>
                  ) : null}
                  {(() => {
                    // Milestones stage: single plain-text output. Read from the
                    // most recent milestones-phase event's completion string, or
                    // (as a fallback) from draftPayload.milestones which persists
                    // through approval.
                    if (stage.stage === 'extract_milestones') {
                      const milestonesEvent = [...evs]
                        .reverse()
                        .find(
                          (e) =>
                            (e.metrics as { phase?: string } | null)?.phase ===
                              'milestones' &&
                            typeof (e.metrics as { completion?: unknown } | null)
                              ?.completion === 'string',
                        );
                      const fromEvent =
                        (milestonesEvent?.metrics as { completion?: string } | null)
                          ?.completion ?? null;
                      const fromDraft =
                        (stage.draftPayload as { milestones?: string } | null)
                          ?.milestones ?? null;
                      const text = fromEvent ?? fromDraft;
                      if (!text) return null;
                      return (
                        <CollapsibleSubsection title="Output">
                          <pre
                            style={{
                              background: 'var(--color-gray-50, #f8f8f8)',
                              border: '1px solid var(--color-gray-200, #e5e5e5)',
                              borderRadius: 4,
                              padding: 8,
                              fontSize: 12,
                              lineHeight: 1.5,
                              maxHeight: 480,
                              overflow: 'auto',
                              whiteSpace: 'pre-wrap',
                              margin: 0,
                            }}
                          >
                            {text}
                          </pre>
                        </CollapsibleSubsection>
                      );
                    }
                    if (stage.stage === 'map_codes') {
                      // When the new map_codes history view is wired up, the
                      // per-code output browser is redundant — the codes table
                      // is the canonical place for per-code detail. Skip it.
                      if (useMapHistory) return null;
                      // Mapping: browse per-code completions. Each event carries
                      // the per-code metadata (attempts, model, invalidIds) +
                      // the full parsed mapping in `completion`.
                      const mapEvents = evs.filter(
                        (e) =>
                          (e.metrics as { phase?: string } | null)?.phase === 'map' &&
                          (e.metrics as { completion?: unknown } | null)?.completion,
                      );
                      if (mapEvents.length === 0) return null;
                      return (
                        <CollapsibleSubsection title="Output">
                          <CompletionBrowser
                            events={mapEvents}
                            emptyLabel="No mapping completions yet."
                            renderLabel={(e) => {
                              const m = (e.metrics ?? {}) as Record<string, unknown>;
                              const code = typeof m.code === 'string' ? m.code : '';
                              const model = typeof m.model === 'string' ? m.model : '';
                              const attempts =
                                typeof m.attempts === 'number' ? m.attempts : null;
                              const invalidCount = Array.isArray(m.invalidIds)
                                ? m.invalidIds.length
                                : 0;
                              const tail = [
                                model,
                                attempts !== null ? `${attempts} attempts` : null,
                                invalidCount > 0 ? `${invalidCount} invalid IDs` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ');
                              return `${code}${tail ? ` — ${tail}` : ''}`;
                            }}
                            renderItem={() => null}
                            renderRaw={(event) => {
                              const m = (event.metrics ?? {}) as Record<string, unknown>;
                              const mapping = m.completion;
                              return (
                                <pre
                                  style={{
                                    margin: 0,
                                    fontSize: 11,
                                    lineHeight: 1.5,
                                    whiteSpace: 'pre-wrap',
                                  }}
                                >
                                  {JSON.stringify(mapping, null, 2)}
                                </pre>
                              );
                            }}
                          />
                        </CollapsibleSubsection>
                      );
                    }
                    const phase1 = evs.filter(
                      (e) =>
                        (e.metrics as { phase?: string } | null)?.phase === 'identify',
                    );
                    const phase2 = evs.filter(
                      (e) =>
                        (e.metrics as { phase?: string } | null)?.phase === 'extract',
                    );
                    if (phase1.length === 0 && phase2.length === 0) return null;
                    return (
                      <CollapsibleSubsection title="Output">
                        <Stack space="s">
                          <Stack space="xxs">
                            <Text weight="bold">Phase 1 — Identify modules</Text>
                            <CompletionBrowser
                              events={phase1}
                              emptyLabel="No Phase 1 completions yet."
                              renderLabel={(e) => {
                                const m = (e.metrics ?? {}) as Record<string, unknown>;
                                return typeof m.url === 'string' ? m.url : '';
                              }}
                              renderItem={(item, key) => {
                                const obj = (item ?? {}) as { category?: string };
                                return (
                                  <div key={key} style={{ padding: '2px 0' }}>
                                    {obj.category ?? String(item)}
                                  </div>
                                );
                              }}
                            />
                          </Stack>
                          <Stack space="xxs">
                            <Text weight="bold">Phase 2 — Extract codes</Text>
                            <CompletionBrowser
                              events={phase2}
                              emptyLabel="No Phase 2 completions yet."
                              renderLabel={(e) => {
                                const m = (e.metrics ?? {}) as Record<string, unknown>;
                                const url = typeof m.url === 'string' ? m.url : '';
                                const cat =
                                  typeof m.category === 'string' ? m.category : '';
                                return cat ? `${url} · ${cat}` : url;
                              }}
                              renderItem={(item, key) => {
                                const obj = (item ?? {}) as {
                                  category?: string;
                                  description?: string;
                                };
                                return (
                                  <div
                                    key={key}
                                    style={{
                                      padding: '4px 0',
                                      borderBottom:
                                        '1px solid var(--color-gray-200, #e5e5e5)',
                                    }}
                                  >
                                    <div style={{ fontWeight: 'bold' }}>
                                      {obj.description ?? ''}
                                    </div>
                                    <div style={{ color: '#737373' }}>
                                      {obj.category ?? ''}
                                    </div>
                                  </div>
                                );
                              }}
                            />
                          </Stack>
                        </Stack>
                      </CollapsibleSubsection>
                    );
                  })()}
                  {useMapHistory && mapHistoryLoading ? (
                    <CollapsibleSubsection title="Metadata">
                      <Text color="secondary">Loading mapping history...</Text>
                    </CollapsibleSubsection>
                  ) : useMapHistory && mapHistoryError ? (
                    <CollapsibleSubsection title="Metadata">
                      <Text color="secondary">{mapHistoryError}</Text>
                    </CollapsibleSubsection>
                  ) : useMapHistory && activeMapHistory && hasMapHistory ? (
                    <CollapsibleSubsection title="Metadata">
                      <MapCodesRunBrowser history={activeMapHistory} mode="metadata" />
                    </CollapsibleSubsection>
                  ) : summaryPairs(stage.outputSummary).length > 0 ? (
                    <CollapsibleSubsection title="Metadata">
                      {summaryPairs(stage.outputSummary).map(([k, v]) => (
                        <Text key={k} color="secondary">
                          {k}: {v}
                        </Text>
                      ))}
                    </CollapsibleSubsection>
                  ) : null}
                  {summaryPairs(stage.draftPayload).length > 0 ? (
                    <CollapsibleSubsection title="Draft">
                      <pre
                        style={{
                          background: 'var(--color-gray-50, #f5f5f5)',
                          padding: 8,
                          fontSize: 12,
                          overflow: 'auto',
                          margin: 0,
                        }}
                      >
                        {JSON.stringify(stage.draftPayload, null, 2)}
                      </pre>
                    </CollapsibleSubsection>
                  ) : null}
                  {runInputs.length > 0 ? (
                    <CollapsibleSubsection title="Inputs">
                      {runInputs.map((inp) => (
                        <Text key={inp.url} color="secondary">
                          [{sourceLabel(inp.source, sources)}] {inp.url}
                        </Text>
                      ))}
                    </CollapsibleSubsection>
                  ) : null}
                  {useMapHistory && activeMapHistory && hasMapHistory ? (
                    <CollapsibleSubsection
                      title={`Log · ${activeMapHistory.events.length} events across ${activeMapHistory.runs.length} run${activeMapHistory.runs.length === 1 ? '' : 's'}`}
                    >
                      <MapCodesRunBrowser history={activeMapHistory} mode="logs" />
                    </CollapsibleSubsection>
                  ) : evs.length > 0 ? (
                    <CollapsibleSubsection title={`Log · ${evs.length} events`}>
                      <div
                        style={{
                          maxHeight: 320,
                          overflowY: 'auto',
                          background: 'var(--color-gray-50, #f8f8f8)',
                          border: '1px solid var(--color-gray-200, #e5e5e5)',
                          borderRadius: 4,
                          padding: 8,
                          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                          fontSize: 12,
                          lineHeight: 1.5,
                        }}
                      >
                        {evs.map((e) => {
                          const m = (e.metrics ?? {}) as Record<string, unknown>;
                          const ts = new Date(e.createdAt).toLocaleTimeString();
                          const metaParts: string[] = [];
                          if (typeof m.durationMs === 'number') {
                            metaParts.push(formatMs(m.durationMs));
                          }
                          const cost = formatCost(m.costUsd);
                          if (cost) metaParts.push(cost);
                          const total =
                            (typeof m.inputTokens === 'number' ? m.inputTokens : 0) +
                            (typeof m.outputTokens === 'number' ? m.outputTokens : 0) +
                            (typeof m.reasoningTokens === 'number'
                              ? m.reasoningTokens
                              : 0);
                          const tokens = formatTokens(total);
                          if (tokens) metaParts.push(`${tokens} tokens`);
                          return (
                            <div
                              key={e.id}
                              style={{
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              <span style={{ color: 'var(--color-gray-500, #737373)' }}>
                                [{ts}]
                              </span>{' '}
                              <span style={{ color: LEVEL_COLOR[e.level] ?? 'inherit' }}>
                                {LEVEL_ICON[e.level] ?? '•'}
                              </span>{' '}
                              {e.message}
                              {metaParts.length > 0 ? (
                                <span style={{ color: 'var(--color-gray-500, #737373)' }}>
                                  {' '}
                                  · {metaParts.join(' · ')}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleSubsection>
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          </CardBox>
        )}
      </Card>
    </div>
  );
}
