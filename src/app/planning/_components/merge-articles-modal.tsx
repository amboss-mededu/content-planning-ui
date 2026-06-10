'use client';

import {
  Callout,
  Checkbox,
  Input,
  Modal,
  Select,
  Stack,
  Text,
} from '@amboss/design-system';
import { useMemo, useState } from 'react';
import { mergeArticles } from '@/app/planning/[specialty]/actions';

export type MergeCandidate = {
  articleKey: string;
  articleTitle: string;
  numCodes: number;
  category?: string;
};

/**
 * Merge several consolidated articles into one. The editor picks the rows
 * to combine and which of them is the surviving target; the rest are folded
 * in (codes unioned, coverage recomputed) and deleted. Source reviews are
 * deleted, source comments/sources/runs re-pointed to the target, and a
 * backlog assignee is preserved when only a source had one.
 */
export function MergeArticlesModal({
  slug,
  candidates,
  onClose,
  onMerged,
}: {
  slug: string;
  candidates: MergeCandidate[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetKey, setTargetKey] = useState<string>('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byKey = useMemo(() => {
    const m = new Map<string, MergeCandidate>();
    for (const c of candidates) if (c.articleKey) m.set(c.articleKey, c);
    return m;
  }, [candidates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter(
      (c) => c.articleKey && (!q || c.articleTitle.toLowerCase().includes(q)),
    );
  }, [candidates, search]);

  const selectedList = useMemo(
    () => Array.from(selected).filter((k) => byKey.has(k)),
    [selected, byKey],
  );

  const toggle = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      // Keep the target valid: drop it if it left the selection, default to
      // the first remaining pick when none is set.
      setTargetKey((t) => {
        if (!checked && t === key) return '';
        if (!t && next.size > 0) return Array.from(next)[0];
        return t;
      });
      return next;
    });
  };

  const sources = selectedList.filter((k) => k !== targetKey);
  const mergedCodeEstimate = useMemo(() => {
    // Upper bound — the server dedupes by code, so the real count is ≤ this.
    return selectedList.reduce((sum, k) => sum + (byKey.get(k)?.numCodes ?? 0), 0);
  }, [selectedList, byKey]);

  const canMerge = selectedList.length >= 2 && !!targetKey && sources.length >= 1;

  const submit = async () => {
    if (!canMerge) return;
    setSaving(true);
    setError(null);
    try {
      const result = await mergeArticles(slug, targetKey, sources);
      if (result.error) {
        setError(result.error);
        return;
      }
      onMerged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge articles.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      header="Merge articles"
      subHeader="Combine several articles into one. The target keeps its title and review; the others are folded in and removed."
      size="l"
      isDismissible
      onAction={onClose}
      actionButton={{
        text: saving ? 'Merging…' : 'Merge articles',
        onClick: submit,
        disabled: saving || !canMerge,
      }}
      secondaryButton={{ text: 'Cancel', onClick: onClose }}
    >
      <Modal.Stack>
        <Stack space="m">
          <Stack space="xs">
            <Input
              label="Find articles"
              name="merge-search"
              placeholder="Search by title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div
              style={{
                maxHeight: 260,
                overflowY: 'auto',
                border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.1))',
                borderRadius: 4,
              }}
            >
              {filtered.length === 0 ? (
                <div style={{ padding: '8px 10px' }}>
                  <Text size="s" color="secondary">
                    No matching articles.
                  </Text>
                </div>
              ) : (
                filtered.map((c) => (
                  <div
                    key={c.articleKey}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderBottom: '1px solid var(--ads-c-divider, rgba(0,0,0,0.05))',
                    }}
                  >
                    <Checkbox
                      label={c.articleTitle || '(untitled)'}
                      checked={selected.has(c.articleKey)}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        toggle(c.articleKey, e.target.checked)
                      }
                    />
                    <span style={{ marginLeft: 'auto' }}>
                      <Text size="s" color="secondary">
                        {c.numCodes} code{c.numCodes === 1 ? '' : 's'}
                      </Text>
                    </span>
                  </div>
                ))
              )}
            </div>
          </Stack>

          {selectedList.length >= 2 ? (
            <Stack space="xs">
              <Select
                name="merge-target"
                label="Keep as target"
                value={targetKey}
                options={selectedList.map((k) => ({
                  value: k,
                  label: byKey.get(k)?.articleTitle || '(untitled)',
                }))}
                onChange={(e) => setTargetKey(e.target.value)}
              />
              <Text size="s" color="secondary">
                {sources.length} article{sources.length === 1 ? '' : 's'} will be merged
                into the target (~{mergedCodeEstimate} codes before dedupe).
              </Text>
              <Callout
                type="warning"
                text="The merged-in articles' reviews are deleted and the articles removed. Their comments, sources, and draft/lit-search runs move to the target. If only a merged-in article had a backlog assignee, that backlog row is kept on the target."
              />
            </Stack>
          ) : (
            <Text size="s" color="secondary">
              Select at least two articles to merge.
            </Text>
          )}

          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
