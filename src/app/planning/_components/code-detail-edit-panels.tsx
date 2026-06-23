'use client';

import {
  Button,
  Checkbox,
  Divider,
  Inline,
  Input,
  Stack,
  Text,
  Textarea,
} from '@amboss/design-system';
import { useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import type { CoveredSection, NewArticle, SectionUpdate } from '@/lib/pb/types';

/**
 * Edit panels for the code detail modal's JSON-array tabs. Each editor keeps a
 * local draft of the full array, lets the user add/remove items, and on Save
 * sends the whole array back through `save` (the modal PATCHes it as a full
 * replacement — last-write-wins, acceptable for this internal tool). The
 * server recomputes the derived count columns from the saved arrays.
 *
 * Kept out of `code-detail-modal.tsx` (already ~800 lines) so the modal stays
 * focused on orchestration.
 */

type SaveFn<V> = (next: V) => Promise<void>;

function useSaver(onClose: () => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, run };
}

function Footer({
  saving,
  error,
  onSave,
  onCancel,
}: {
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Stack space="xs">
      {error ? (
        <Text size="s" color="error">
          {error}
        </Text>
      ) : null}
      <Inline space="xs" vAlignItems="center">
        <Button
          variant="primary"
          size="s"
          onClick={onSave}
          loading={saving}
          disabled={saving}
        >
          Save
        </Button>
        <Button variant="secondary" size="s" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </Inline>
    </Stack>
  );
}

// --- Coverage articles -----------------------------------------------------

export function CoverageArticlesEditor({
  initial,
  save,
  onClose,
}: {
  initial: CoveredSection[];
  save: SaveFn<CoveredSection[]>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CoveredSection[]>(() => clone(initial));
  const { saving, error, run } = useSaver(onClose);

  const patch = (i: number, next: Partial<CoveredSection>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...next } : it)));

  return (
    <Stack space="m">
      {items.map((art, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: array is the editable identity; reorder isn't supported
        <Stack key={i} space="xs">
          <Inline space="xs" vAlignItems="center" alignItems="spaceBetween" fullWidth>
            <Text size="s" weight="bold" color="secondary">
              Article {i + 1}
            </Text>
            <Button
              variant="secondary"
              size="s"
              onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
            >
              Remove article
            </Button>
          </Inline>
          <Input
            label="Article title"
            name={`cov-title-${i}`}
            value={art.articleTitle ?? ''}
            onChange={(e) => patch(i, { articleTitle: e.target.value })}
          />
          <Input
            label="Article ID"
            name={`cov-id-${i}`}
            value={art.articleId ?? ''}
            onChange={(e) => patch(i, { articleId: e.target.value })}
          />
          <Text size="xs" weight="bold" color="secondary" transform="uppercase">
            Sections
          </Text>
          {(art.sections ?? []).map((sec, si) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional identity
            <Inline key={si} space="xs" vAlignItems="bottom" fullWidth>
              <Input
                label="Section title"
                name={`cov-sec-title-${i}-${si}`}
                value={sec.sectionTitle ?? ''}
                onChange={(e) =>
                  patch(i, {
                    sections: replaceAt(art.sections ?? [], si, {
                      ...sec,
                      sectionTitle: e.target.value,
                    }),
                  })
                }
              />
              <Input
                label="Section ID"
                name={`cov-sec-id-${i}-${si}`}
                value={sec.sectionId ?? ''}
                onChange={(e) =>
                  patch(i, {
                    sections: replaceAt(art.sections ?? [], si, {
                      ...sec,
                      sectionId: e.target.value,
                    }),
                  })
                }
              />
              <Button
                variant="secondary"
                size="s"
                onClick={() => patch(i, { sections: removeAt(art.sections ?? [], si) })}
              >
                Remove
              </Button>
            </Inline>
          ))}
          <Inline>
            <Button
              variant="secondary"
              size="s"
              onClick={() => patch(i, { sections: [...(art.sections ?? []), {}] })}
            >
              + Add section
            </Button>
          </Inline>
          <Divider />
        </Stack>
      ))}
      <Inline>
        <Button
          variant="secondary"
          size="s"
          onClick={() => setItems((arr) => [...arr, { sections: [] }])}
        >
          + Add article
        </Button>
      </Inline>
      <Footer
        saving={saving}
        error={error}
        onSave={() => run(() => save(prune(items)))}
        onCancel={onClose}
      />
    </Stack>
  );
}

// --- Existing article updates ----------------------------------------------

export function ArticleUpdatesEditor({
  initial,
  save,
  onClose,
}: {
  initial: SectionUpdate[];
  save: SaveFn<SectionUpdate[]>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<SectionUpdate[]>(() => clone(initial));
  const { saving, error, run } = useSaver(onClose);

  const patch = (i: number, next: Partial<SectionUpdate>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...next } : it)));

  return (
    <Stack space="m">
      {items.map((upd, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional identity
        <Stack key={i} space="xs">
          <Inline space="xs" vAlignItems="center" alignItems="spaceBetween" fullWidth>
            <Text size="s" weight="bold" color="secondary">
              Article {i + 1}
            </Text>
            <Button
              variant="secondary"
              size="s"
              onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
            >
              Remove article
            </Button>
          </Inline>
          <Input
            label="Article title"
            name={`upd-title-${i}`}
            value={upd.articleTitle ?? ''}
            onChange={(e) => patch(i, { articleTitle: e.target.value })}
          />
          <Input
            label="Article ID"
            name={`upd-id-${i}`}
            value={upd.articleId ?? ''}
            onChange={(e) => patch(i, { articleId: e.target.value })}
          />
          <Text size="xs" weight="bold" color="secondary" transform="uppercase">
            Sections
          </Text>
          {(upd.sections ?? []).map((sec, si) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional identity
            <Stack key={si} space="xxs">
              <Inline space="xs" vAlignItems="bottom" fullWidth>
                <Input
                  label="Section title"
                  name={`upd-sec-title-${i}-${si}`}
                  value={sec.sectionTitle ?? ''}
                  onChange={(e) =>
                    patch(i, {
                      sections: replaceAt(upd.sections ?? [], si, {
                        ...sec,
                        sectionTitle: e.target.value,
                      }),
                    })
                  }
                />
                <Input
                  label="Importance (0–5)"
                  name={`upd-sec-imp-${i}-${si}`}
                  type="number"
                  value={typeof sec.importance === 'number' ? String(sec.importance) : ''}
                  onChange={(e) =>
                    patch(i, {
                      sections: replaceAt(upd.sections ?? [], si, {
                        ...sec,
                        importance:
                          e.target.value === '' ? undefined : Number(e.target.value),
                      }),
                    })
                  }
                />
                <Button
                  variant="secondary"
                  size="s"
                  onClick={() => patch(i, { sections: removeAt(upd.sections ?? [], si) })}
                >
                  Remove
                </Button>
              </Inline>
              <Checkbox
                label="Section already exists (update vs. new section)"
                checked={sec.exists ?? false}
                onChange={(e) =>
                  patch(i, {
                    sections: replaceAt(upd.sections ?? [], si, {
                      ...sec,
                      exists: e.target.checked,
                    }),
                  })
                }
              />
              <Textarea
                label="Changes"
                name={`upd-sec-changes-${i}-${si}`}
                resize="vertical"
                // The DS Textarea defaults maxLength to 256, which silently
                // truncates longer text. Lift it past any realistic entry.
                maxLength={50000}
                value={sec.changes ?? ''}
                onChange={(e) =>
                  patch(i, {
                    sections: replaceAt(upd.sections ?? [], si, {
                      ...sec,
                      changes: e.target.value,
                    }),
                  })
                }
              />
            </Stack>
          ))}
          <Inline>
            <Button
              variant="secondary"
              size="s"
              onClick={() => patch(i, { sections: [...(upd.sections ?? []), {}] })}
            >
              + Add section
            </Button>
          </Inline>
          <Divider />
        </Stack>
      ))}
      <Inline>
        <Button
          variant="secondary"
          size="s"
          onClick={() => setItems((arr) => [...arr, { sections: [] }])}
        >
          + Add article
        </Button>
      </Inline>
      <Footer
        saving={saving}
        error={error}
        onSave={() => run(() => save(prune(items)))}
        onCancel={onClose}
      />
    </Stack>
  );
}

// --- New articles needed ---------------------------------------------------

export function NewArticlesEditor({
  initial,
  save,
  onClose,
}: {
  initial: NewArticle[];
  save: SaveFn<NewArticle[]>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<NewArticle[]>(() => clone(initial));
  const { saving, error, run } = useSaver(onClose);

  const patch = (i: number, next: Partial<NewArticle>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...next } : it)));

  return (
    <Stack space="m">
      {items.map((a, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional identity
        <Inline key={i} space="xs" vAlignItems="bottom" fullWidth>
          <Input
            label="Article title"
            name={`new-title-${i}`}
            value={a.articleTitle ?? ''}
            onChange={(e) => patch(i, { articleTitle: e.target.value })}
          />
          <Input
            label="Importance (0–5)"
            name={`new-imp-${i}`}
            type="number"
            value={typeof a.importance === 'number' ? String(a.importance) : ''}
            onChange={(e) =>
              patch(i, {
                importance: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
          />
          <Button
            variant="secondary"
            size="s"
            onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
          >
            Remove
          </Button>
        </Inline>
      ))}
      <Inline>
        <Button
          variant="secondary"
          size="s"
          onClick={() => setItems((arr) => [...arr, {}])}
        >
          + Add new article
        </Button>
      </Inline>
      <Footer
        saving={saving}
        error={error}
        onSave={() => run(() => save(prune(items)))}
        onCancel={onClose}
      />
    </Stack>
  );
}

// --- Plain text fields (notes / gaps / improvements) -----------------------

export function TextFieldsEditor({
  fields,
  save,
  onClose,
}: {
  fields: Array<{ key: string; label: string; value: string }>;
  save: SaveFn<Record<string, string>>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value])),
  );
  const { saving, error, run } = useSaver(onClose);

  return (
    <Stack space="m">
      {fields.map((f) => (
        <Textarea
          key={f.key}
          label={f.label}
          name={`text-${f.key}`}
          resize="vertical"
          // The DS Textarea defaults maxLength to 256, which silently
          // truncates longer text. Lift it past any realistic entry.
          maxLength={50000}
          value={draft[f.key] ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
        />
      ))}
      <Footer
        saving={saving}
        error={error}
        onSave={() => run(() => save(draft))}
        onCancel={onClose}
      />
    </Stack>
  );
}

// --- helpers ---------------------------------------------------------------

function clone<T>(arr: T[]): T[] {
  return arr.map((x) => structuredClone(x));
}

function replaceAt<T>(arr: T[], i: number, next: T): T[] {
  return arr.map((x, idx) => (idx === i ? next : x));
}

function removeAt<T>(arr: T[], i: number): T[] {
  return arr.filter((_, idx) => idx !== i);
}

/** Drop fully-empty items so a stray "+ Add" click doesn't persist a blank. */
function prune<T>(items: T[]): T[] {
  return items.filter((item) => {
    const it = item as {
      articleTitle?: string;
      articleId?: string;
      sections?: unknown[];
      importance?: number;
    };
    const hasArticle = it.articleTitle?.trim() || it.articleId?.trim();
    const hasSections = Array.isArray(it.sections) && it.sections.length > 0;
    const hasImportance = typeof it.importance === 'number';
    return Boolean(hasArticle) || hasSections || hasImportance;
  });
}
