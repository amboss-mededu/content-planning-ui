'use client';

import {
  Badge,
  Button,
  Inline,
  LoadingSpinner,
  Modal,
  Stack,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { BucketCode, CategoryOrchestration } from '@/lib/data/categories';
import { getConsolidationActionLabel } from '@/lib/workflows/consolidation/buckets';
import { listBucketCodes } from '../[specialty]/actions';
import { ConsolidationProgressBadge } from './consolidation-progress-badge';
import { useConsolidationRerun } from './use-consolidation-rerun';
import { useRerunningCategories } from './use-rerunning-categories';

type CategoryStatus = 'not-ready' | 'ready' | 'consolidated';

function deriveStatus(r: CategoryOrchestration): CategoryStatus {
  if (r.isUnbucketed) return 'not-ready';
  const mapped = r.numMappedCodes >= r.numCodes;
  if (!mapped) return 'not-ready';
  return r.hasConsolidatedOutput ? 'consolidated' : 'ready';
}

function StatusBadge({
  bucket,
  isRerunning,
}: {
  bucket: CategoryOrchestration;
  isRerunning: boolean;
}) {
  if (isRerunning) {
    return <ConsolidationProgressBadge />;
  }
  const status = deriveStatus(bucket);
  if (status === 'consolidated') {
    return <Badge text="Consolidated" color="green" icon="check" />;
  }
  if (status === 'ready') {
    return <Badge text="Ready for consolidation" color="brand" />;
  }
  return <Badge text="Not ready" color="gray" />;
}

function CodeStatusBadge({ status }: { status: BucketCode['status'] }) {
  if (status === 'included') return <Badge text="included" color="green" />;
  if (status === 'excluded') return <Badge text="excluded" color="gray" />;
  if (status === 'ignored') return <Badge text="ignored" color="yellow" />;
  if (status === 'pending') return <Badge text="not consolidated" color="gray" />;
  return <Badge text="orphan" color="red" />;
}

function MappingCounts({ bucket }: { bucket: CategoryOrchestration }) {
  const rows: Array<{ label: string; value: number | null }> = [
    { label: '# Codes', value: bucket.numCodes },
    { label: '# Mapped', value: bucket.numMappedCodes },
    { label: '# Included', value: bucket.numIncludedCodes },
    { label: '# Excluded', value: bucket.numExcludedCodes },
    { label: '# Ignored', value: bucket.numTotallyIgnoredCodes },
    { label: '# Orphan', value: bucket.numOrphanCodes },
  ];
  return (
    <Stack space="xs">
      {rows.map((r) => (
        <Inline key={r.label} space="s">
          <Text size="s" weight="bold">
            {r.label}:
          </Text>
          <Text size="s">{r.value === null ? '—' : r.value}</Text>
        </Inline>
      ))}
    </Stack>
  );
}

function CodesList({ codes }: { codes: BucketCode[] }) {
  if (codes.length === 0) {
    return (
      <Text size="s" color="secondary">
        No codes in this bucket.
      </Text>
    );
  }
  return (
    <Stack space="xs">
      {codes.map((c) => (
        <Inline key={c.code} space="s" vAlignItems="center">
          <span
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 12,
              minWidth: 80,
            }}
          >
            {c.code}
          </span>
          <CodeStatusBadge status={c.status} />
          {!c.mapped && <Badge text="unmapped" color="gray" />}
          {c.description && (
            <Text size="xs" color="secondary">
              {c.description}
            </Text>
          )}
        </Inline>
      ))}
    </Stack>
  );
}

export function CategoryDetailsModal({
  bucket,
  slug,
  onRunningChange,
  onClose,
}: {
  bucket: CategoryOrchestration;
  slug: string;
  onRunningChange?: (category: string, running: boolean) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [codes, setCodes] = useState<BucketCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    rerun,
    isRunning,
    error: rerunError,
    dismissError: dismissRerunError,
    lastResult,
    dismissLastResult,
  } = useConsolidationRerun(slug);
  // Live cross-tab signal so the modal shows "Rebuilding…" if the run was
  // started from the consolidation review screen — not just from this
  // modal. The local in-flight `isRunning` covers the optimistic case
  // before PB's realtime delivers the create event.
  const rebuildingCategories = useRerunningCategories(slug);
  const status = deriveStatus(bucket);
  const canRerun = status === 'consolidated' || status === 'ready';
  const isRerunning =
    isRunning(bucket.consolidationCategory) ||
    rebuildingCategories.has(bucket.consolidationCategory);

  useEffect(() => {
    onRunningChange?.(bucket.consolidationCategory, isRerunning);
    return () => {
      onRunningChange?.(bucket.consolidationCategory, false);
    };
  }, [bucket.consolidationCategory, isRerunning, onRunningChange]);

  const sourceCategoriesInBucket = useMemo(() => {
    if (!codes) return [];
    const set = new Set<string>();
    for (const c of codes) {
      if (c.category) set.add(c.category);
    }
    return Array.from(set);
  }, [codes]);
  const codesNotLoaded = codes === null;

  useEffect(() => {
    let cancelled = false;
    setCodes(null);
    setError(null);
    listBucketCodes(slug, bucket.consolidationCategory)
      .then((rows) => {
        if (!cancelled) setCodes(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, bucket.consolidationCategory]);

  const mappingHref = `/planning/${encodeURIComponent(slug)}/mapping?consolidationCategory=${encodeURIComponent(bucket.consolidationCategory)}`;

  return (
    <Modal
      header={bucket.consolidationCategory}
      subHeader={bucket.source ? `Source: ${bucket.source}` : undefined}
      size="l"
      isDismissible
      onAction={() => onClose()}
      privateProps={{ height: '80vh' }}
      closeButtonAriaLabel="Close category details"
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          height: '100%',
          minHeight: 0,
        }}
      >
        <Inline space="s" vAlignItems="center">
          <Text size="s" weight="bold">
            Status:
          </Text>
          <StatusBadge bucket={bucket} isRerunning={isRerunning} />
        </Inline>

        <MappingCounts bucket={bucket} />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            borderTop: '1px solid rgb(230, 230, 235)',
            paddingTop: 12,
          }}
        >
          <Stack space="s">
            <Text size="s" weight="bold">
              Codes
            </Text>
            {error ? (
              <Text size="s" color="error">
                Failed to load codes: {error}
              </Text>
            ) : codes === null ? (
              <Inline space="s" vAlignItems="center">
                <LoadingSpinner screenReaderText="Loading codes" />
                <Text size="s" color="secondary">
                  Loading codes…
                </Text>
              </Inline>
            ) : (
              <CodesList codes={codes} />
            )}
          </Stack>
        </div>

        {rerunError ? (
          <button
            type="button"
            onClick={dismissRerunError}
            style={{
              textAlign: 'left',
              padding: '6px 8px',
              border: '1px solid rgb(220, 38, 38)',
              borderRadius: 4,
              background: 'rgb(254, 226, 226)',
              cursor: 'pointer',
              font: 'inherit',
              color: 'rgb(127, 29, 29)',
              fontSize: 12,
            }}
            title="Dismiss"
          >
            {rerunError}
          </button>
        ) : null}
        {lastResult ? (
          <button
            type="button"
            onClick={dismissLastResult}
            style={{
              textAlign: 'left',
              padding: '6px 8px',
              border:
                lastResult.consolidatedArticles + lastResult.consolidatedSections > 0
                  ? '1px solid rgb(16, 185, 129)'
                  : '1px solid rgb(217, 119, 6)',
              borderRadius: 4,
              background:
                lastResult.consolidatedArticles + lastResult.consolidatedSections > 0
                  ? 'rgb(220, 252, 231)'
                  : 'rgb(255, 247, 219)',
              cursor: 'pointer',
              font: 'inherit',
              color:
                lastResult.consolidatedArticles + lastResult.consolidatedSections > 0
                  ? 'rgb(6, 95, 70)'
                  : 'rgb(120, 53, 15)',
              fontSize: 12,
            }}
            title="Dismiss"
          >
            Result · {lastResult.stagingArticles} primary article candidate
            {lastResult.stagingArticles === 1 ? '' : 's'} · {lastResult.stagingSections}{' '}
            primary section candidate
            {lastResult.stagingSections === 1 ? '' : 's'} ·{' '}
            {lastResult.consolidatedArticles} final article
            {lastResult.consolidatedArticles === 1 ? '' : 's'} ·{' '}
            {lastResult.consolidatedSections} final section
            {lastResult.consolidatedSections === 1 ? '' : 's'}
          </button>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button
            variant="secondary"
            onClick={() => {
              router.push(mappingHref);
            }}
          >
            Drill into mapping view
          </Button>
          <Button
            variant="secondary"
            disabled={!canRerun || isRerunning || codesNotLoaded}
            onClick={() => {
              void rerun(bucket.consolidationCategory, {
                hasOutput: bucket.hasConsolidatedOutput,
                additionalCategories: sourceCategoriesInBucket,
              });
            }}
          >
            {getConsolidationActionLabel({
              hasOutput: bucket.hasConsolidatedOutput,
              isConsolidating: isRerunning,
            })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
