'use client';

import { Callout, Input, Modal, Stack, Text } from '@amboss/design-system';
import { useEffect, useMemo, useState } from 'react';
import {
  listCodesForArticlePicker,
  renameArticle,
  updateArticleCodes,
} from '@/app/planning/[specialty]/actions';
import type { PickerCode } from '@/lib/data/categories';
import type { EmbeddedCode } from './code-utils';

/**
 * Edit a consolidated article: rename it and add/remove its codes. Both
 * are content-affecting — a rename migrates the article key across every
 * joined collection (reviews, backlog, comments, sources, runs), and a
 * code change recomputes coverage server-side. Saved via the
 * `renameArticle` / `updateArticleCodes` server actions, then the parent
 * refreshes.
 */
export function EditArticleModal({
  slug,
  articleKey,
  articleTitle,
  consolidationCategory,
  codes,
  onClose,
  onSaved,
}: {
  slug: string;
  articleKey: string;
  articleTitle: string;
  /** The article's consolidation bucket — used to default-filter the code
   *  picker to in-bucket codes. */
  consolidationCategory?: string;
  codes: EmbeddedCode[];
  onClose: () => void;
  /** Called after a successful save with the (possibly new) article key so
   *  the parent can re-resolve the row. */
  onSaved: (articleKey: string) => void;
}) {
  const originalTitle = articleTitle.trim();
  const [title, setTitle] = useState(articleTitle);
  const [draftCodes, setDraftCodes] = useState<EmbeddedCode[]>(codes);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [pickerRows, setPickerRows] = useState<PickerCode[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load codes for the picker — in-bucket by default, the whole specialty
  // when "show all" is toggled on. Refetched on toggle.
  useEffect(() => {
    let cancelled = false;
    setPickerRows(null);
    setPickerError(null);
    const category = showAll ? undefined : consolidationCategory;
    listCodesForArticlePicker(slug, category)
      .then((rows) => {
        if (!cancelled) setPickerRows(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPickerError(e instanceof Error ? e.message : 'Failed to load codes.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, consolidationCategory, showAll]);

  const draftCodeSet = useMemo(
    () => new Set(draftCodes.map((c) => c.code)),
    [draftCodes],
  );

  const available = useMemo(() => {
    if (!pickerRows) return [];
    const q = search.trim().toLowerCase();
    return pickerRows
      .filter((r) => !draftCodeSet.has(r.code))
      .filter(
        (r) =>
          !q ||
          r.code.toLowerCase().includes(q) ||
          (r.description?.toLowerCase().includes(q) ?? false),
      );
  }, [pickerRows, draftCodeSet, search]);

  const titleChanged = title.trim().length > 0 && title.trim() !== originalTitle;
  const codesChanged = useMemo(() => {
    if (draftCodes.length !== codes.length) return true;
    const original = new Set(codes.map((c) => c.code));
    return draftCodes.some((c) => !original.has(c.code));
  }, [draftCodes, codes]);
  const dirty = titleChanged || codesChanged;

  const addCode = (r: PickerCode) => {
    setDraftCodes((prev) =>
      prev.some((c) => c.code === r.code)
        ? prev
        : [...prev, { code: r.code, description: r.description, category: r.category }],
    );
  };
  const removeCode = (code: string) => {
    setDraftCodes((prev) => prev.filter((c) => c.code !== code));
  };

  const save = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    if (!title.trim()) {
      setError('Title cannot be empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let effectiveKey = articleKey;
      if (titleChanged) {
        const result = await renameArticle(slug, articleKey, title.trim());
        if (result.error) {
          setError(result.error);
          return;
        }
        effectiveKey = result.articleKey;
      }
      if (codesChanged) {
        const result = await updateArticleCodes(slug, effectiveKey, draftCodes);
        if (result.error) {
          setError(result.error);
          return;
        }
      }
      onSaved(effectiveKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      header="Edit article"
      subHeader="Rename the article or change its codes. Coverage is recomputed automatically."
      size="l"
      isDismissible
      onAction={onClose}
      actionButton={{
        text: saving ? 'Saving…' : 'Save changes',
        onClick: save,
        disabled: saving || !dirty,
      }}
      secondaryButton={{ text: 'Cancel', onClick: onClose }}
    >
      <Modal.Stack>
        <Stack space="m">
          <Stack space="xs">
            <Input
              label="Article title"
              name="edit-article-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {titleChanged ? (
              <Callout
                type="info"
                text="Renaming changes this article's identity: its reviews, backlog state, comments, and sources are migrated to the new title. A future consolidation re-run may regenerate the old title as a separate article (this is how manual edits already behave)."
              />
            ) : null}
          </Stack>

          <Stack space="xs">
            <Text weight="bold">Codes ({draftCodes.length})</Text>
            {draftCodes.length === 0 ? (
              <Text size="s" color="secondary">
                No codes — coverage will show “—”.
              </Text>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {draftCodes.map((c) => (
                  <RemovableCodeChip
                    key={c.code}
                    code={c.code}
                    description={c.description}
                    onRemove={() => removeCode(c.code)}
                  />
                ))}
              </div>
            )}
          </Stack>

          <Stack space="xs">
            <Input
              label="Add codes"
              name="edit-article-code-search"
              placeholder="Search by code or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              style={{
                alignSelf: 'flex-start',
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                color: 'var(--ads-c-action, #0a66c2)',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {showAll
                ? 'Show only codes in this bucket'
                : 'Show all codes in the specialty'}
            </button>

            {pickerError ? (
              <Callout type="error" text={pickerError} />
            ) : pickerRows === null ? (
              <Text size="s" color="secondary">
                Loading codes…
              </Text>
            ) : available.length === 0 ? (
              <Text size="s" color="secondary">
                {search.trim() ? 'No matching codes.' : 'No more codes available to add.'}
              </Text>
            ) : (
              <div
                style={{
                  maxHeight: 220,
                  overflowY: 'auto',
                  border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.1))',
                  borderRadius: 4,
                }}
              >
                {available.slice(0, 100).map((r) => (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => addCode(r)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      textAlign: 'left',
                      background: 'none',
                      border: 'none',
                      borderBottom: '1px solid var(--ads-c-divider, rgba(0,0,0,0.05))',
                      padding: '6px 10px',
                      font: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    <span aria-hidden style={{ color: 'var(--ads-c-action, #0a66c2)' }}>
                      ＋
                    </span>
                    <strong style={{ flexShrink: 0 }}>{r.code}</strong>
                    <span
                      style={{
                        color: 'var(--ads-c-text-secondary, #555)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.description ?? ''}
                    </span>
                  </button>
                ))}
                {available.length > 100 ? (
                  <div style={{ padding: '6px 10px' }}>
                    <Text size="s" color="secondary">
                      {available.length - 100} more — refine your search.
                    </Text>
                  </div>
                ) : null}
              </div>
            )}
          </Stack>

          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}

function RemovableCodeChip({
  code,
  description,
  onRemove,
}: {
  code: string;
  description?: string;
  onRemove: () => void;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 4px 2px 8px',
        borderRadius: 12,
        background: 'var(--ads-c-surface-subtle, rgba(0,0,0,0.05))',
        fontSize: 13,
      }}
      title={description ?? code}
    >
      {code}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${code}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(0,0,0,0.12)',
          color: 'inherit',
          cursor: 'pointer',
          font: 'inherit',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </span>
  );
}
