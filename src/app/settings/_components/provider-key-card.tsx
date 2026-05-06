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
  PasswordInput,
  Stack,
  Text,
} from '@amboss/design-system';
import { useState } from 'react';

export type ProviderId = 'google' | 'anthropic' | 'openai';

const PROVIDER_LABEL: Record<ProviderId, string> = {
  google: 'Google (Gemini)',
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
};

const HINT: Record<ProviderId, string> = {
  google: 'Get one at aistudio.google.com/apikey',
  anthropic: 'Get one at console.anthropic.com/settings/keys',
  openai: 'Get one at platform.openai.com/api-keys',
};

function formatTested(testedAt: number | null): string {
  if (!testedAt) return 'never';
  return new Date(testedAt).toLocaleString();
}

function statusBadge(args: { configured: boolean; status: 'ok' | 'failed' | null }): {
  label: string;
  color: 'gray' | 'green' | 'red' | 'yellow';
} {
  if (!args.configured) return { label: 'Not configured', color: 'gray' };
  if (args.status === 'ok') return { label: 'Tested · OK', color: 'green' };
  if (args.status === 'failed') return { label: 'Tested · failed', color: 'red' };
  return { label: 'Saved · not tested', color: 'yellow' };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? `${res.status} ${res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

export function ProviderKeyCard({
  provider,
  configured,
  testedAt,
  status,
  onChange,
}: {
  provider: ProviderId;
  configured: boolean;
  testedAt: number | null;
  status: 'ok' | 'failed' | null;
  onChange: () => void | Promise<void>;
}) {
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState<null | 'save' | 'clear' | 'test'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const badge = statusBadge({ configured, status });

  function clearTransient() {
    setError(null);
    setNotice(null);
  }

  async function onSave() {
    clearTransient();
    if (!keyInput.trim()) {
      setError('Paste a key first.');
      return;
    }
    setBusy('save');
    try {
      const res = await fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, key: keyInput }),
      });
      if (!res.ok) {
        setError(await readError(res));
      } else {
        setKeyInput('');
        setNotice('Saved. Click Test connection to verify.');
        await onChange();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onClear() {
    clearTransient();
    setBusy('clear');
    try {
      const res = await fetch('/api/settings/keys', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      if (!res.ok) {
        setError(await readError(res));
      } else {
        setKeyInput('');
        setNotice('Cleared.');
        await onChange();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    clearTransient();
    setBusy('test');
    try {
      const res = await fetch('/api/settings/test-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (body.ok) setNotice('Connection OK.');
      else setError(body.message ?? 'Test failed.');
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card outlined>
      <Box vSpace="m" lSpace="l" rSpace="l">
        <Inline space="s" vAlignItems="center">
          <H5 as="h3">{PROVIDER_LABEL[provider]}</H5>
          <Badge text={badge.label} color={badge.color} />
        </Inline>
      </Box>
      <Divider />
      <CardBox>
        <Stack space="s">
          {configured ? (
            <Text color="secondary">
              Last tested: {formatTested(testedAt)}. Re-saving replaces the key.
            </Text>
          ) : (
            <Text color="secondary">{HINT[provider]}</Text>
          )}
          <PasswordInput
            label={configured ? 'Replace key' : 'API key'}
            value={keyInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setKeyInput(e.target.value)
            }
            placeholder={configured ? '•••••••• (saved)' : 'Paste your key'}
            autoComplete="off"
            slotProps={{
              toggleVisibility: {
                ariaLabelShow: 'Show key',
                ariaLabelHide: 'Hide key',
              },
            }}
          />
          {notice && <Text color="success">{notice}</Text>}
          {error && (
            <Text color="error" weight="bold">
              {error}
            </Text>
          )}
          <Inline space="s" vAlignItems="center">
            <Button
              type="button"
              onClick={onSave}
              disabled={busy !== null || keyInput.trim().length === 0}
            >
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="tertiary"
              onClick={onTest}
              disabled={busy !== null || !configured}
            >
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </Button>
            <Button
              type="button"
              variant="tertiary"
              onClick={onClear}
              disabled={busy !== null || !configured}
            >
              {busy === 'clear' ? 'Clearing…' : 'Clear'}
            </Button>
          </Inline>
        </Stack>
      </CardBox>
    </Card>
  );
}
