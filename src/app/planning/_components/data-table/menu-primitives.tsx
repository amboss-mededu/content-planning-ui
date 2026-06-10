'use client';

import type { ReactNode } from 'react';

export function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--ads-c-text-secondary, rgba(0,0,0,0.6))',
        fontWeight: 700,
        padding: '6px 8px 2px',
      }}
    >
      {children}
    </div>
  );
}

export function MenuDivider() {
  return (
    <div
      style={{
        height: 1,
        background: 'var(--ads-c-divider, rgba(0,0,0,0.08))',
        margin: '4px 0',
      }}
    />
  );
}

export function MenuItem({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: active
          ? 'var(--ads-c-surface-accent, rgba(0, 90, 180, 0.12))'
          : 'none',
        color: active ? 'var(--ads-c-text-accent, #0055aa)' : 'inherit',
        border: 'none',
        borderRadius: 4,
        padding: '6px 8px',
        fontSize: 13,
        font: 'inherit',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      {children}
    </button>
  );
}
