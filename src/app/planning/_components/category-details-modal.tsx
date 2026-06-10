'use client';

import {
  Badge,
  Button,
  Callout,
  Inline,
  LoadingSpinner,
  Modal,
  Stack,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BucketCode, CategoryOrchestration } from '@/lib/data/categories';
import { errorMessage } from '@/lib/error-message';
import { getConsolidationActionLabel } from '@/lib/workflows/consolidation/buckets';
import { listBucketCodes } from '../[specialty]/actions';
import { ConsolidationProgressBadge } from './consolidation-progress-badge';
import { RerunConfirmModal } from './rerun-confirm-modal';
import type { ConsolidationRerunOptions, RerunResult } from './use-consolidation-rerun';

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
  rerun,
  isRerunning,
  rerunError,
  onDismissRerunError,
  lastResult,
  onDismissLastResult,
  onClose,
}: {
  bucket: CategoryOrchestration;
  slug: string;
  rerun: (category: string, options?: ConsolidationRerunOptions) => Promise<void>;
  isRerunning: boolean;
  rerunError: string | null;
  onDismissRerunError: () => void;
  lastResult: RerunResult | null;
  onDismissLastResult: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [codes, setCodes] = useState<BucketCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const status = deriveStatus(bucket);
  const canRerun = status === 'consolidated' || status === 'ready';
  const hasOutput = bucket.hasConsolidatedOutput;

  // Fetch the bucket's codes, showing the loading spinner while in flight.
  // Returns a cleanup that suppresses a stale resolution (modal closed /
  // bucket switched mid-fetch).
  const loadCodes = useCallback(() => {
    let cancelled = false;
    setCodes(null);
    setError(null);
    listBucketCodes(slug, bucket.consolidationCategory)
      .then((rows) => {
        if (!cancelled) setCodes(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, bucket.consolidationCategory]);

  useEffect(() => loadCodes(), [loadCodes]);

  // Refetch the codes list when a rerun finishes (isRerunning true → false).
  // The parent's router.refresh() updates counts/status, but the codes list
  // is fetched here and would otherwise stay stale until the modal reopens.
  const wasRerunning = useRef(isRerunning);
  useEffect(() => {
    if (wasRerunning.current && !isRerunning) loadCodes();
    wasRerunning.current = isRerunning;
  }, [isRerunning, loadCodes]);

  const mappingHref = `/planning/${encodeURIComponent(slug)}/mapping?consolidationCategory=${encodeURIComponent(bucket.consolidationCategory)}`;

  return (
    <>
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
            <Stack space="xs">
              <Callout type="error" text={rerunError} />
              <Inline space="s">
                <Button variant="tertiary" onClick={onDismissRerunError}>
                  Dismiss
                </Button>
              </Inline>
            </Stack>
          ) : null}
          {lastResult ? (
            <button
              type="button"
              onClick={onDismissLastResult}
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
              disabled={!canRerun || isRerunning}
              onClick={() => setConfirmOpen(true)}
            >
              {getConsolidationActionLabel({
                hasOutput: bucket.hasConsolidatedOutput,
                isConsolidating: isRerunning,
              })}
            </Button>
          </div>
        </div>
      </Modal>
      <RerunConfirmModal
        open={confirmOpen}
        category={bucket.consolidationCategory}
        hasOutput={hasOutput}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={(editorNote) => {
          setConfirmOpen(false);
          void rerun(bucket.consolidationCategory, {
            hasOutput,
            editorNote,
          });
        }}
      />
    </>
  );
}
