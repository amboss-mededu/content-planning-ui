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
import { useEffect, useState } from 'react';
import type { BucketCode, CategoryOrchestration } from '@/lib/data/categories';
import { listBucketCodes } from '../[specialty]/actions';
import { useConsolidationRerun } from './use-consolidation-rerun';

type CategoryStatus = 'not-ready' | 'ready' | 'consolidated';

function deriveStatus(r: CategoryOrchestration): CategoryStatus {
  if (r.isUnbucketed) return 'not-ready';
  const mapped = r.numMappedCodes >= r.numCodes;
  if (!mapped) return 'not-ready';
  return r.hasConsolidatedOutput ? 'consolidated' : 'ready';
}

function StatusBadge({ bucket }: { bucket: CategoryOrchestration }) {
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
  return <Badge text="orphan" color="red" />;
}

function MappingCounts({ bucket }: { bucket: CategoryOrchestration }) {
  const rows: Array<{ label: string; value: number }> = [
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
          <Text size="s">{r.value}</Text>
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
  onClose,
}: {
  bucket: CategoryOrchestration;
  slug: string;
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
  } = useConsolidationRerun(slug);
  const status = deriveStatus(bucket);
  // Re-run only makes sense once the category is mappable and has been
  // through consolidation at least once (otherwise editors should use the
  // initial run path from the consolidation review screen).
  const canRerun = status === 'consolidated' || status === 'ready';
  const isRerunning = isRunning(bucket.consolidationCategory);

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
          <StatusBadge bucket={bucket} />
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
            onClick={() => {
              void rerun(bucket.consolidationCategory);
            }}
          >
            {isRerunning ? 'Re-running…' : 'Re-run consolidation'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
