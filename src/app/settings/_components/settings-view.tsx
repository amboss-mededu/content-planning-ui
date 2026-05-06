'use client';

import { H1, Stack, Text } from '@amboss/design-system';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { type ProviderId, ProviderKeyCard } from './provider-key-card';

const PROVIDERS: ProviderId[] = ['google', 'anthropic', 'openai'];

export function SettingsView() {
  // useConvexAuth was removed in the auth cutover (PR 3); the proxy now
  // gates this page via PB cookie auth, so we know the user is signed in
  // by the time this component renders. The useQuery still calls Convex
  // and will fail at runtime against the wiped DB — PR 5 (data layer)
  // replaces it with a PocketBase SDK call.
  const status = useQuery(api.apiKeys.getStatusForCurrentUser, {});

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
          />
        ))}
      </Stack>
    </Stack>
  );
}
