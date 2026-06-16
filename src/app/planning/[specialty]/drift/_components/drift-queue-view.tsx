'use client';

import {
  Badge,
  Button,
  Callout,
  Card,
  CardBox,
  H2,
  Inline,
  Stack,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import type { ContentChangeEventType } from '@/lib/pb/types';
import type { DriftContentRef, DriftImpact } from '@/lib/workflows/drift/drift-impacts';

type ImpactWithId = DriftImpact & { eventId: string };

/** Badge color per change type — no semantic meaning, just consistent variety. */
const CHANGE_COLOR: Record<
  ContentChangeEventType,
  'blue' | 'purple' | 'gray' | 'brand' | 'red'
> = {
  renamed: 'blue',
  moved: 'purple',
  archived: 'gray',
  merged: 'brand',
  deleted: 'red',
};

const REF_KIND_LABEL: Record<DriftContentRef['kind'], string> = {
  code: 'Mapped code',
  article: 'New article',
  section: 'Section update',
  backlog: 'Backlog item',
};

function formatRelative(ts: number | undefined): string {
  if (!ts) return 'unknown time';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function DriftQueueView({
  impacts,
  feedConfigured,
}: {
  impacts: ImpactWithId[];
  /** False when CONTENT_CHANGE_FEED_URL is unset — sync is a no-op. */
  feedConfigured: boolean;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const sync = async () => {
    setSyncing(true);
    setError(null);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/drift/sync', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        ingested?: number;
        stub?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || `Sync failed (${res.status})`);
      setSyncMsg(
        body.stub
          ? 'No feed configured — nothing to sync.'
          : `Synced — ${body.ingested ?? 0} event(s) ingested.`,
      );
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  const resolve = async (eventId: string) => {
    setResolvingId(eventId);
    setError(null);
    try {
      const res = await fetch('/api/drift/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Resolve failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <Stack space="l">
      <Inline space="m" alignItems="spaceBetween" vAlignItems="center">
        <Stack space="xs">
          <H2>CMS drift</H2>
          <Text size="s" color="secondary">
            CMS article changes that touch this specialty's mappings or consolidation
            output. Flagged for review — nothing is changed or deleted automatically.
          </Text>
        </Stack>
        <Button
          variant="secondary"
          size="m"
          leftIcon="rotate-cw"
          loading={syncing}
          onClick={sync}
        >
          Sync feed
        </Button>
      </Inline>

      {!feedConfigured ? (
        <Callout
          type="info"
          text="Content-change feed not configured"
          description="Set CONTENT_CHANGE_FEED_URL to pull live CMS changes. Until then the queue stays empty and Sync is a no-op."
        />
      ) : null}
      {syncMsg ? <Callout type="success" text={syncMsg} /> : null}
      {error ? <Callout type="error" text={error} /> : null}

      {impacts.length === 0 ? (
        <Card outlined>
          <CardBox>
            <Text color="secondary">
              No open drift events. CMS changes appear here after a sync.
            </Text>
          </CardBox>
        </Card>
      ) : (
        <Stack space="m">
          {impacts.map((impact) => (
            <DriftEventCard
              key={impact.eventId}
              impact={impact}
              resolving={resolvingId === impact.eventId}
              onResolve={() => resolve(impact.eventId)}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function DriftEventCard({
  impact,
  resolving,
  onResolve,
}: {
  impact: ImpactWithId;
  resolving: boolean;
  onResolve: () => void;
}) {
  const { event, refs, touchesDownstreamWork } = impact;
  return (
    <Card outlined>
      <CardBox>
        <Stack space="s">
          <Inline space="s" alignItems="spaceBetween" vAlignItems="center">
            <Inline space="xs" vAlignItems="center">
              <Badge text={event.changeType} color={CHANGE_COLOR[event.changeType]} />
              {touchesDownstreamWork ? (
                <Badge text="approved work" color="yellow" icon="alert-triangle" />
              ) : null}
              <Text size="s" color="secondary">
                <span suppressHydrationWarning>{formatRelative(event.occurredAt)}</span>
              </Text>
            </Inline>
            <Button
              variant="tertiary"
              size="s"
              leftIcon="check"
              loading={resolving}
              onClick={onResolve}
            >
              Resolve
            </Button>
          </Inline>

          <Text size="s">
            Article <code>{event.articleEid}</code>
            {event.sectionId ? (
              <>
                {' '}
                · section <code>{event.sectionId}</code>
              </>
            ) : null}
            {event.newTitle ? (
              <>
                {' '}
                → renamed to <strong>{event.newTitle}</strong>
              </>
            ) : null}
            {event.mergedIntoEid ? (
              <>
                {' '}
                → merged into <code>{event.mergedIntoEid}</code>
              </>
            ) : null}
          </Text>

          {refs.length === 0 ? (
            <Text size="s" color="secondary">
              Nothing in this specialty references it — resolve if it doesn't concern you.
            </Text>
          ) : (
            <Stack space="xxs">
              <Text size="s" color="secondary">
                Affects {refs.length} item(s):
              </Text>
              {refs.map((ref) => (
                <Text
                  key={`${ref.kind}-${ref.articleKey ?? ref.code}-${ref.label}`}
                  size="s"
                >
                  · <strong>{REF_KIND_LABEL[ref.kind]}</strong> — {ref.label}
                </Text>
              ))}
            </Stack>
          )}
        </Stack>
      </CardBox>
    </Card>
  );
}
