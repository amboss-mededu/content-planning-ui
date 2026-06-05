'use client';

/**
 * Inline-editable "Google Drive URL" cell, shared by the backlog table column
 * and the article-manager modal's draft phase. Shows a clickable link to the
 * draft's Drive folder (auto-filled by the n8n draft callback, replaced on
 * re-run) plus a pencil to edit/override it manually.
 *
 * Mirrors the commit/cancel/re-sync UX of `EditableCell` (data-table.tsx) but
 * keeps the link and edit affordance as separate, non-nested interactives so a
 * clickable `<Link>` isn't trapped inside an edit `<button>`. Every interactive
 * element stops propagation so the backlog row's `onRowClick` doesn't fire.
 */

import { Link, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { setBacklogDraftFolderUrl } from '@/app/planning/[specialty]/actions';
import { isSafeUrl } from '@/lib/url';

const inputStyle: CSSProperties = {
  width: '100%',
  minWidth: 160,
  padding: '4px 6px',
  border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.25))',
  borderRadius: 4,
  font: 'inherit',
};

const pencilStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  opacity: 0.6,
  flexShrink: 0,
};

export function DriveUrlField({
  slug,
  articleKey,
  articleRecordId,
  value,
  label = 'Drive folder',
}: {
  slug: string;
  articleKey: string;
  articleRecordId: string;
  value: string;
  /** Link text in display mode. */
  label?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Re-sync from the server value once a refresh lands (and we're not editing).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    if (next === (value ?? '').trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setBacklogDraftFolderUrl(slug, articleKey, articleRecordId, next);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
    setError(null);
  };

  if (editing) {
    return (
      <span
        style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, width: '100%' }}
      >
        <input
          ref={inputRef}
          type="text"
          value={draft}
          disabled={saving}
          placeholder="https://drive.google.com/drive/folders/…"
          style={inputStyle}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => {
            if (!saving) void commit();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
        />
        {error ? (
          <Text size="xs" color="error">
            {error}
          </Text>
        ) : saving ? (
          <Text size="xs" color="secondary">
            Saving…
          </Text>
        ) : null}
      </span>
    );
  }

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}
    >
      {value && isSafeUrl(value) ? (
        <Link
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          size="xs"
          color="accent"
          onClick={(e) => (e as React.MouseEvent).stopPropagation()}
        >
          {label}
        </Link>
      ) : value ? (
        // Stored value isn't an http(s) URL — show it as plain text, never a
        // clickable link (defends against an unsafe scheme reaching href).
        <Text size="xs" color="secondary">
          {value}
        </Text>
      ) : (
        <Text size="xs" color="secondary">
          —
        </Text>
      )}
      <button
        type="button"
        title="Edit Google Drive URL"
        aria-label="Edit Google Drive URL"
        style={pencilStyle}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        ✎
      </button>
    </span>
  );
}
