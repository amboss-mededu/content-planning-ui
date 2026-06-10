'use client';

import { Button } from '@amboss/design-system';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Column } from './types';

/**
 * Toolbar dropdown that lists every column with a visibility checkbox. Hidden
 * keys live in `hidden`; toggling a row adds/removes from the set. Mirrors
 * the portal+positioning pattern used by `NumericFilterMenu` so the popover
 * sits above the sticky header bands.
 */
export function ColumnsMenu<T>({
  columns,
  hidden,
  onToggle,
}: {
  columns: Column<T>[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const hiddenCount = hidden.size;

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      setCoords({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const popover =
    open && coords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Toggle columns"
            style={{
              position: 'fixed',
              top: coords.top,
              right: coords.right,
              background: 'var(--ads-c-surface, white)',
              border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              padding: 8,
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              minWidth: 220,
              maxHeight: '60vh',
              overflowY: 'auto',
            }}
          >
            {columns.map((c) => {
              const visible = !hidden.has(c.key);
              return (
                <label
                  key={c.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 13,
                    lineHeight: 1.3,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => onToggle(c.key)}
                  />
                  <span>{c.label}</span>
                </label>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <Button
        ref={buttonRef}
        variant="tertiary"
        size="s"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {`Columns${hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''} ▾`}
      </Button>
      {popover}
    </>
  );
}
