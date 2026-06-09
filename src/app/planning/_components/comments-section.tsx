'use client';

import { Button, Stack, Text } from '@amboss/design-system';
import { useState } from 'react';
import { log } from '@/lib/log';
import type { ReviewCommentRecord, ReviewRecordKind } from '@/lib/pb/types';
import { deleteOwnReviewComment, postReviewComment } from '../[specialty]/actions';

function handleFromEmail(email?: string): string {
  if (!email) return '(unknown)';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

function formatTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString();
}

/** Comment thread for a single review row. Re-mounted per row via the
 *  `key={recordId}` prop on the parent so its draft + optimistic list
 *  reset when the modal navigates. */
export function CommentsSection({
  slug,
  recordKind,
  recordKey,
  recordId,
  initialComments,
  viewerEmail,
}: {
  slug: string;
  recordKind: ReviewRecordKind;
  /** Stable identifier — articleKey or sectionKey depending on
   *  `recordKind`. Empty means "no thread" and disables posting. */
  recordKey: string;
  /** Current PB id of the underlying record. Stored alongside the key
   *  as a debugging breadcrumb; not used for joins. */
  recordId: string;
  initialComments: ReviewCommentRecord[];
  /** Email of the currently signed-in editor. Used to decide which
   *  comments expose a delete affordance — PB also enforces this
   *  server-side via the deleteRule. */
  viewerEmail?: string;
}) {
  const [comments, setComments] = useState<ReviewCommentRecord[]>(initialComments);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const body = draft.trim();
    if (!body || !recordKey) return;
    setSubmitting(true);
    try {
      const created = await postReviewComment(
        slug,
        recordKind,
        recordKey,
        recordId,
        body,
      );
      setComments((prev) => [...prev, created]);
      setDraft('');
    } catch (err) {
      log('comments').error('postReviewComment failed', err);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteComment(commentId: string) {
    const before = comments;
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    try {
      await deleteOwnReviewComment(slug, commentId);
    } catch (err) {
      log('comments').error('deleteOwnReviewComment failed', err);
      setComments(before);
    }
  }

  return (
    <Stack space="xs">
      <Text size="s" weight="bold">
        Comments
      </Text>
      {comments.length === 0 && (
        <Text size="xs" color="secondary">
          No comments yet.
        </Text>
      )}
      {comments.map((c) => {
        const isOwn = !!viewerEmail && c.authorEmail === viewerEmail;
        return (
          <div
            key={c.id}
            style={{
              padding: '8px 10px',
              borderRadius: 4,
              background: 'rgba(0, 0, 0, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              position: 'relative',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <Text size="xs" color="secondary">
                {handleFromEmail(c.authorEmail)} · {formatTime(c.created)}
              </Text>
              {isOwn && (
                <button
                  type="button"
                  onClick={() => deleteComment(c.id)}
                  title="Delete comment"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '0 4px',
                    color: 'rgb(120, 120, 130)',
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <Text size="s">{c.body}</Text>
          </div>
        );
      })}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Leave a comment… (⌘/Ctrl+Enter to post)"
        rows={3}
        style={{
          width: '100%',
          padding: 8,
          fontFamily: 'inherit',
          fontSize: 14,
          borderRadius: 4,
          border: '1px solid rgba(0, 0, 0, 0.15)',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="secondary"
          size="s"
          onClick={submit}
          disabled={submitting || !draft.trim()}
        >
          Add comment
        </Button>
      </div>
    </Stack>
  );
}
