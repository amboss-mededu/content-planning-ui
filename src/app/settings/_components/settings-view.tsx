'use client';

import { H1, Stack, Text } from '@amboss/design-system';
import { useCallback, useEffect, useState } from 'react';
import { type ProviderId, ProviderKeyCard } from './provider-key-card';

const PROVIDERS: ProviderId[] = ['google', 'anthropic', 'openai'];

type ProviderStatus = {
  configured: boolean;
  testedAt: number | null;
  status: 'ok' | 'failed' | null;
};

type AllStatus = Record<ProviderId, ProviderStatus>;

export function SettingsView() {
  const [status, setStatus] = useState<AllStatus | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/settings/keys/status', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as AllStatus;
    setStatus(body);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Stack space="xl">
      <Stack space="s">
        <H1>Settings</H1>
        <Text color="secondary">
          Provider keys are stored per user. Each pipeline stage card lets you pick which
          provider+model to use; the corresponding key here is what powers the run.
        </Text>
      </Stack>
      <Stack space="m">
        {PROVIDERS.map((p) => (
          <ProviderKeyCard
            key={p}
            provider={p}
            configured={status?.[p].configured ?? false}
            testedAt={status?.[p].testedAt ?? null}
            status={status?.[p].status ?? null}
            onChange={refresh}
          />
        ))}
      </Stack>
    </Stack>
  );
}
