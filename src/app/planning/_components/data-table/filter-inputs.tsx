'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { miniButtonStyle } from './constants';
import { MenuDivider, MenuSectionLabel } from './menu-primitives';

/**
 * Multi-select filter section rendered inside the header dropdown for
 * categorical columns. Shows a typeahead that narrows the option list, a
 * row of bulk affordances ("All" / "None" scoped to the current matches),
 * and a checkbox per option. Closes are caller-controlled — selection
 * doesn't auto-close so users can pick several values in one open.
 */
export function CategoricalFilter({
  options,
  selected,
  showSortDivider,
  onChange,
  onClose,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  showSortDivider: boolean;
  onChange: (next: string[] | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Auto-focus the search field when the menu opens. Using a ref-effect (vs
  // `autoFocus`) avoids the JSX-a11y lint hit and keeps the focus behavior
  // explicit at mount time.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      const next = selected.filter((v) => v !== value);
      onChange(next.length > 0 ? next : null);
    } else {
      onChange([...selected, value]);
    }
  };

  const selectAllVisible = () => {
    const next = new Set(selected);
    for (const o of visibleOptions) next.add(o.value);
    onChange(next.size > 0 ? [...next] : null);
  };

  const clearVisible = () => {
    if (visibleOptions.length === options.length) {
      // No active query — "None" clears everything.
      onChange(null);
      return;
    }
    const visibleVals = new Set(visibleOptions.map((o) => o.value));
    const next = selected.filter((v) => !visibleVals.has(v));
    onChange(next.length > 0 ? next : null);
  };

  return (
    <>
      {showSortDivider ? <MenuDivider /> : null}
      <MenuSectionLabel>
        Filter{selected.length > 0 ? ` · ${selected.length} selected` : ''}
      </MenuSectionLabel>
      <div style={{ padding: '4px 6px' }}>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          onKeyDown={(e) => {
            // Enter on a single visible result is a quick "toggle this one"
            // shortcut. Escape bubbles up to the popover for dismiss.
            if (e.key === 'Enter' && visibleOptions.length === 1) {
              e.preventDefault();
              toggle(visibleOptions[0].value);
            }
          }}
          style={{
            width: '100%',
            padding: '4px 8px',
            border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
            borderRadius: 4,
            fontSize: 13,
            font: 'inherit',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '0 6px 4px',
          fontSize: 12,
        }}
      >
        <button
          type="button"
          onClick={selectAllVisible}
          disabled={visibleOptions.length === 0}
          style={miniButtonStyle}
        >
          {query ? 'Select matches' : 'Select all'}
        </button>
        <button type="button" onClick={clearVisible} style={miniButtonStyle}>
          {query ? 'Clear matches' : 'Clear'}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{ ...miniButtonStyle, marginLeft: 'auto' }}
        >
          Done
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {visibleOptions.length === 0 ? (
          <div
            style={{
              padding: '8px 10px',
              fontSize: 12,
              color: 'var(--ads-c-text-secondary, rgba(0,0,0,0.55))',
            }}
          >
            No matches.
          </div>
        ) : (
          visibleOptions.map((opt) => {
            const checked = selectedSet.has(opt.value);
            return (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  // Top-align so the checkbox lines up with the first line
                  // of a wrapped label rather than centering against the
                  // whole multi-line block.
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '5px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 13,
                  background: checked
                    ? 'var(--ads-c-surface-accent, rgba(0, 90, 180, 0.10))'
                    : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!checked) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                }}
                onMouseLeave={(e) => {
                  if (!checked) e.currentTarget.style.background = 'transparent';
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                  // Prevent the checkbox from shrinking when the label
                  // wraps to multiple lines.
                  style={{ flexShrink: 0, marginTop: 2 }}
                />
                <span
                  style={{
                    // Wrap long values (e.g. multi-word category names)
                    // instead of forcing the popover to grow horizontally.
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                    lineHeight: 1.35,
                  }}
                >
                  {opt.label}
                </span>
              </label>
            );
          })
        )}
      </div>
    </>
  );
}

/**
 * Free-form text filter section rendered inside the header dropdown for
 * columns with `filterMode: 'contains'`. Used for free-form fields like
 * Description where a checkbox list of unique values would be useless. Keeps
 * a local draft so the row set isn't re-filtered on every keystroke; commits
 * on blur, Enter, or Apply. Esc reverts the draft to the committed value.
 */
export function ContainsFilter({
  value,
  showSortDivider,
  onChange,
  onClose,
}: {
  value: string | null;
  showSortDivider: boolean;
  onChange: (next: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string>(value ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Auto-focus the search box on open. Mirrors CategoricalFilter behavior so
  // both filter modes feel identical to the keyboard.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Pull the committed value back into the draft if the parent clears the
  // filter externally (e.g. via the toolbar's "Clear filters" button).
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const apply = () => {
    onChange(draft.trim() === '' ? null : draft);
    onClose();
  };

  const clear = () => {
    setDraft('');
    onChange(null);
  };

  return (
    <>
      {showSortDivider ? <MenuDivider /> : null}
      <MenuSectionLabel>Contains{value ? ' · active' : ''}</MenuSectionLabel>
      <div style={{ padding: '4px 6px' }}>
        <input
          ref={inputRef}
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(value ?? '');
              onClose();
            }
          }}
          placeholder="Type to filter…"
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
            borderRadius: 4,
            fontSize: 13,
            font: 'inherit',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '0 6px 4px',
          fontSize: 12,
        }}
      >
        <button type="button" onClick={clear} style={miniButtonStyle}>
          Clear
        </button>
        <button
          type="button"
          onClick={apply}
          style={{ ...miniButtonStyle, marginLeft: 'auto' }}
        >
          Apply
        </button>
      </div>
    </>
  );
}
