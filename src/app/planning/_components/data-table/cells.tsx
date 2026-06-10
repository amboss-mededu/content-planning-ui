'use client';

import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import { DEFAULT_ROW_STRIPE, GROUP_STYLES } from './constants';
import type { Column, EditableConfig } from './types';

export function TableCells<T>({
  row,
  columns,
  rowIndex,
}: {
  row: T;
  columns: Column<T>[];
  rowIndex: number;
}) {
  // Odd rows pick up a stripe tint so the table reads as a zebra pattern.
  // For grouped columns the tint is the group's color (light blue-grey for
  // metadata, light green for coverage, light orange for suggestions); for
  // ungrouped columns and tables without groups, fall back to the default
  // grey so every table has the same readability without each call site
  // having to opt in. Even rows stay plain white.
  const stripe = rowIndex % 2 === 1;
  return (
    <>
      {columns.map((c) => (
        <td
          key={c.key}
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid var(--ads-c-divider, rgba(0,0,0,0.05))',
            // Vertical column dividers, matching the header row's
            // `borderRight` so the grid lines are continuous from the
            // sticky header through every body cell.
            borderRight: '1px solid var(--ads-c-divider, rgba(0,0,0,0.08))',
            verticalAlign: c.verticalAlign ?? 'middle',
            textAlign: c.align ?? 'left',
            maxWidth: 360,
            background: stripe
              ? c.group
                ? GROUP_STYLES[c.group].stripe
                : DEFAULT_ROW_STRIPE
              : 'transparent',
          }}
        >
          {/*
           * Wrap the rendered cell content in a flex row so cell-level
           * alignment is enforced by `justifyContent` rather than
           * relying on `textAlign` to cascade through arbitrary nested
           * elements (DS components, <button>s, inline-flex wrappers).
           * That makes the alignment robust to UA button defaults and
           * to design-system components that introduce their own block
           * layout — a colored Badge or chip stays centered inside an
           * align:'center' cell instead of pinning to the left edge.
           */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                c.align === 'right'
                  ? 'flex-end'
                  : c.align === 'center'
                    ? 'center'
                    : 'flex-start',
              width: '100%',
            }}
          >
            {c.editable ? (
              <EditableCell row={row} column={c} editable={c.editable} />
            ) : (
              c.render(row)
            )}
          </div>
        </td>
      ))}
    </>
  );
}

export function EditableCell<T>({
  row,
  column,
  editable,
}: {
  row: T;
  column: Column<T>;
  editable: EditableConfig<T>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(() => editable.getValue(row));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // When the underlying row changes (e.g. after a refresh picked up a new
  // server value), stop editing and re-sync the draft.
  useEffect(() => {
    if (!editing) setValue(editable.getValue(row));
  }, [row, editable, editing]);

  // Ref-driven focus on open avoids the `autoFocus` a11y lint warning while
  // keeping the expected "click a cell → caret is inside the input" UX.
  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current ?? inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [editing]);

  const commit = async () => {
    const next = value.trim();
    const prev = editable.getValue(row);
    if (next === prev) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await editable.onSave(row, next);
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setValue(editable.getValue(row));
    setEditing(false);
    setError(null);
  };

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {editable.multiline ? (
          <textarea
            ref={textareaRef}
            value={value}
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (!saving) commit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            style={{
              width: '100%',
              minHeight: 60,
              padding: '6px 8px',
              border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.25))',
              borderRadius: 4,
              font: 'inherit',
              lineHeight: 1.4,
              resize: 'vertical',
            }}
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={value}
            disabled={saving}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              if (!saving) commit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            style={{
              width: '100%',
              padding: '4px 6px',
              border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.25))',
              borderRadius: 4,
              font: 'inherit',
            }}
          />
        )}
        {error ? (
          <span style={{ color: 'var(--color-red-500)', fontSize: 12 }}>{error}</span>
        ) : saving ? (
          <span style={{ color: 'var(--ads-c-text-secondary)', fontSize: 12 }}>
            Saving…
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      title="Click to edit"
      style={{
        display: 'inline-flex',
        alignItems: 'flex-start',
        gap: 6,
        background: hover ? 'var(--ads-c-surface-subtle, rgba(0,0,0,0.03))' : 'none',
        border: '1px dashed transparent',
        borderColor: hover ? 'var(--ads-c-divider, rgba(0,0,0,0.2))' : 'transparent',
        borderRadius: 3,
        padding: '2px 4px',
        margin: '-2px -4px',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'text',
        width: 'fit-content',
        maxWidth: '100%',
      }}
    >
      <span style={{ flex: 1, whiteSpace: 'normal', wordBreak: 'break-word' }}>
        {column.render(row)}
      </span>
      <span
        aria-hidden
        style={{
          fontSize: 11,
          opacity: hover ? 0.7 : 0,
          transition: 'opacity 120ms',
          flexShrink: 0,
        }}
      >
        ✎
      </span>
    </button>
  );
}
