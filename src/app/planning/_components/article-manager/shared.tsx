'use client';

// Shared chrome + leaf style helpers for the Article Manager modal family.
// Extracted verbatim from article-manager-modal-v2.tsx.

import { Badge, Inline, Stack, Text } from '@amboss/design-system';
import type { CSSProperties } from 'react';
import type { ReviewerInfo, ReviewStatus } from './types';

function reviewerHandle(email?: string): string {
  if (!email) return 'unknown';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export function reviewerLabel(
  info: ReviewerInfo | undefined,
  status: ReviewStatus,
): string {
  const handle = reviewerHandle(info?.reviewerEmail);
  const when = info?.reviewedAt ? new Date(info.reviewedAt).toLocaleString() : null;
  return when ? `${status} by ${handle} · ${when}` : `${status} by ${handle}`;
}

export type BadgeColor =
  | 'gray'
  | 'green'
  | 'yellow'
  | 'red'
  | 'purple'
  | 'blue'
  | 'brand';

export function SharedHeader({
  title,
  stageBadge,
  decisionBadge,
  decisionBadgeNode,
  extraBadges,
  metaInline,
}: {
  title: string;
  /** Optional stage indicator. Backlog views omit this (the modal already
   *  scopes by surface; no need for a redundant "Backlog" badge). Review
   *  views still pass it so editors see they're in the review surface. */
  stageBadge?: { text: string; color: BadgeColor };
  decisionBadge: { text: string; color: BadgeColor; tooltip?: string } | null;
  /** Live ReactNode override for the decision badge slot. Takes precedence
   *  over `decisionBadge` when present — used so the backlog modal can
   *  swap in `<LitSearchProgressBadge />` while the lit-search worker is
   *  running, without re-implementing the badge layout. */
  decisionBadgeNode?: React.ReactNode;
  extraBadges?: Array<{ text: string; color: BadgeColor }>;
  metaInline?: React.ReactNode;
}) {
  return (
    <Stack space="s">
      <Inline space="s" vAlignItems="center">
        <Text size="m" weight="bold">
          {title}
        </Text>
        {stageBadge ? <Badge text={stageBadge.text} color={stageBadge.color} /> : null}
        {extraBadges?.map((b) => (
          <Badge key={b.text} text={b.text} color={b.color} />
        ))}
        {decisionBadgeNode
          ? decisionBadgeNode
          : decisionBadge &&
            (decisionBadge.tooltip ? (
              <span title={decisionBadge.tooltip}>
                <Badge text={decisionBadge.text} color={decisionBadge.color} />
              </span>
            ) : (
              <Badge text={decisionBadge.text} color={decisionBadge.color} />
            ))}
      </Inline>
      {metaInline}
    </Stack>
  );
}

export function DecisionNoteField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <Stack space="xs">
      <Text size="s" weight="bold">
        Decision note
      </Text>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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
      />
    </Stack>
  );
}

export const footerStyle: CSSProperties = {
  flex: 'none',
  borderTop: '1px solid rgba(0, 0, 0, 0.12)',
  padding: '10px 0',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

export const decideButtonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 4,
  border: '1px solid rgba(0, 0, 0, 0.15)',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
};

export function decideButton(active: boolean, kind: 'approve' | 'reject'): CSSProperties {
  if (!active) return decideButtonBase;
  if (kind === 'approve') {
    return {
      ...decideButtonBase,
      background: 'rgb(16, 185, 129)',
      borderColor: 'rgb(16, 185, 129)',
      color: '#fff',
    };
  }
  return {
    ...decideButtonBase,
    background: 'rgb(220, 38, 38)',
    borderColor: 'rgb(220, 38, 38)',
    color: '#fff',
  };
}
