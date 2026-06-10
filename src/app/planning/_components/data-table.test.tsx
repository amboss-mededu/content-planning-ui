/**
 * Characterization tests for DataTable, written ahead of the planned
 * decomposition into `data-table/` modules. They interact through the
 * rendered UI (header menus, popovers, toolbar buttons) — not internals —
 * so the suite must pass unchanged against both the current monolith and
 * the decomposed version.
 *
 * `@tanstack/react-virtual` is mocked because the table always virtualizes
 * (VIRTUALIZE_THRESHOLD = 0) and the real virtualizer measures a 0-height
 * scroll container in jsdom, rendering zero rows. The mock returns every
 * row as a virtual item.
 */
import { light, ThemeProvider } from '@amboss/design-system';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Column, DataTable } from './data-table';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 36,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        index,
        key: index,
        start: index * 36,
        end: (index + 1) * 36,
        size: 36,
      })),
    measureElement: () => {},
  }),
}));

type Row = {
  id: string;
  name: string;
  score: number | null;
  desc: string;
  done: boolean;
};

const ROWS: Row[] = [
  { id: 'r1', name: 'alpha', score: 10, desc: 'First entry', done: false },
  { id: 'r2', name: 'beta', score: 5, desc: 'Second ENTRY', done: true },
  { id: 'r3', name: '', score: null, desc: 'third', done: false },
  { id: 'r4', name: 'gamma', score: 20, desc: 'fourth entry', done: true },
];

const COLUMNS: Column<Row>[] = [
  { key: 'id', label: 'ID', render: (r) => r.id, accessor: (r) => r.id },
  {
    key: 'name',
    label: 'Name',
    render: (r) => r.name,
    accessor: (r) => r.name,
    filterable: true,
  },
  {
    key: 'score',
    label: 'Score',
    render: (r) => String(r.score ?? ''),
    accessor: (r) => r.score,
    type: 'number',
    filterable: true,
  },
  {
    key: 'desc',
    label: 'Description',
    render: (r) => r.desc,
    accessor: (r) => r.desc,
    filterable: true,
    filterMode: 'contains',
  },
  {
    key: 'done',
    label: 'Done',
    render: (r) => (r.done ? 'yes' : 'no'),
    accessor: (r) => r.done,
    type: 'boolean',
  },
];

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <ThemeProvider theme={light}>
      <DataTable<Row> rows={ROWS} columns={COLUMNS} getRowKey={(r) => r.id} {...props} />
    </ThemeProvider>,
  );
}

/** Visible row order, read as the ID-column cell of each body row. */
function rowIds(): string[] {
  return [...document.querySelectorAll('tbody tr')]
    .map((tr) => tr.querySelector('td')?.textContent ?? '')
    .filter((t) => t !== '');
}

function openHeaderMenu(label: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
  return screen.getByRole('dialog', { name: `${label} options` });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DataTable rendering', () => {
  it('renders all rows and the unfiltered count', () => {
    renderTable();
    expect(rowIds()).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(screen.getByText('4 rows')).toBeDefined();
  });

  it('renders emptyText instead of a table when rows are empty', () => {
    renderTable({ rows: [], emptyText: 'Nothing here.' });
    expect(screen.getByText('Nothing here.')).toBeDefined();
    expect(document.querySelector('table')).toBeNull();
  });

  it('appends countAddendum and leadingNote to the count line', () => {
    renderTable({
      countAddendum: (rows) => `${rows.length} visible`,
      leadingNote: 'live view',
    });
    expect(screen.getByText('4 rows (4 visible) · live view')).toBeDefined();
  });
});

describe('DataTable sorting', () => {
  it('sorts numbers ascending with nullish values last', () => {
    renderTable();
    const menu = openHeaderMenu('Score');
    fireEvent.click(within(menu).getByText('Sort ascending'));
    expect(rowIds()).toEqual(['r2', 'r1', 'r4', 'r3']);
  });

  it('keeps nullish values last when descending', () => {
    renderTable();
    const menu = openHeaderMenu('Score');
    fireEvent.click(within(menu).getByText('Sort descending'));
    expect(rowIds()).toEqual(['r4', 'r1', 'r2', 'r3']);
  });

  it('sorts booleans false-first ascending', () => {
    renderTable();
    const menu = openHeaderMenu('Done');
    fireEvent.click(within(menu).getByText('Sort ascending'));
    expect(rowIds()).toEqual(['r1', 'r3', 'r2', 'r4']);
  });

  it('Reset sort is disabled until a sort is active, then restores input order', () => {
    renderTable();
    const reset = screen.getByRole('button', { name: 'Reset sort' });
    expect(reset.hasAttribute('disabled')).toBe(true);
    const menu = openHeaderMenu('Score');
    fireEvent.click(within(menu).getByText('Sort descending'));
    expect(reset.hasAttribute('disabled')).toBe(false);
    fireEvent.click(reset);
    expect(rowIds()).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
});

describe('DataTable filtering', () => {
  it('numeric filter excludes non-matching rows and rows with null values', () => {
    renderTable();
    const menu = openHeaderMenu('Score');
    fireEvent.change(within(menu).getByRole('combobox'), {
      target: { value: '>=' },
    });
    fireEvent.change(within(menu).getByPlaceholderText('value'), {
      target: { value: '10' },
    });
    fireEvent.click(within(menu).getByText('Apply'));
    expect(rowIds()).toEqual(['r1', 'r4']);
    expect(screen.getByText('Showing 2 of 4 rows')).toBeDefined();
  });

  it('numeric != still excludes rows with no value', () => {
    renderTable();
    const menu = openHeaderMenu('Score');
    fireEvent.change(within(menu).getByRole('combobox'), {
      target: { value: '!=' },
    });
    fireEvent.change(within(menu).getByPlaceholderText('value'), {
      target: { value: '5' },
    });
    fireEvent.click(within(menu).getByText('Apply'));
    expect(rowIds()).toEqual(['r1', 'r4']);
  });

  it('categorical multi-select ORs the selected values', () => {
    renderTable();
    const menu = openHeaderMenu('Name');
    fireEvent.click(within(menu).getByLabelText('alpha'));
    expect(rowIds()).toEqual(['r1']);
    fireEvent.click(within(menu).getByLabelText('gamma'));
    expect(rowIds()).toEqual(['r1', 'r4']);
  });

  it('offers a (Blanks) option that matches only empty values', () => {
    renderTable();
    const menu = openHeaderMenu('Name');
    fireEvent.click(within(menu).getByLabelText('(Blanks)'));
    expect(rowIds()).toEqual(['r3']);
    fireEvent.click(within(menu).getByLabelText('alpha'));
    expect(rowIds()).toEqual(['r1', 'r3']);
  });

  it('contains filter is a case-insensitive substring match', () => {
    renderTable();
    const menu = openHeaderMenu('Description');
    fireEvent.change(within(menu).getByPlaceholderText('Type to filter…'), {
      target: { value: 'entry' },
    });
    fireEvent.click(within(menu).getByText('Apply'));
    expect(rowIds()).toEqual(['r1', 'r2', 'r4']);
  });

  it('filterValue takes precedence over accessor for matching', () => {
    const columns: Column<Row>[] = [
      COLUMNS[0],
      {
        key: 'name',
        label: 'Name',
        render: (r) => r.name,
        accessor: (r) => r.name,
        filterValue: (r) => (r.score !== null && r.score >= 10 ? 'high' : 'low'),
        filterable: true,
      },
    ];
    renderTable({ columns });
    const menu = openHeaderMenu('Name');
    fireEvent.click(within(menu).getByLabelText('high'));
    expect(rowIds()).toEqual(['r1', 'r4']);
  });

  it('Clear filters resets every filter at once', () => {
    renderTable();
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    expect(clear.hasAttribute('disabled')).toBe(true);
    const menu = openHeaderMenu('Name');
    fireEvent.click(within(menu).getByLabelText('alpha'));
    fireEvent.click(within(menu).getByText('Done'));
    expect(rowIds()).toEqual(['r1']);
    expect(clear.hasAttribute('disabled')).toBe(false);
    fireEvent.click(clear);
    expect(rowIds()).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
});

describe('DataTable onVisibleRowsChange', () => {
  it('fires with the sorted, filtered row set', () => {
    const seen: Row[][] = [];
    renderTable({ onVisibleRowsChange: (rows) => seen.push(rows) });
    expect(seen.at(-1)?.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    const menu = openHeaderMenu('Score');
    fireEvent.click(within(menu).getByText('Sort descending'));
    expect(seen.at(-1)?.map((r) => r.id)).toEqual(['r4', 'r1', 'r2', 'r3']);
  });
});

describe('DataTable column visibility', () => {
  it('defaultHidden seeds the hidden set and the Columns menu re-enables it', () => {
    const columns = COLUMNS.map((c) =>
      c.key === 'done' ? { ...c, defaultHidden: true } : c,
    );
    renderTable({ columns });
    expect(screen.queryByRole('button', { name: /^Done/ })).toBeNull();
    const trigger = screen.getByRole('button', { name: /^Columns/ });
    expect(trigger.textContent).toContain('(1 hidden)');
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Toggle columns' });
    fireEvent.click(within(dialog).getByLabelText('Done'));
    expect(screen.getByRole('button', { name: /^Done/ })).toBeDefined();
  });
});

describe('DataTable localStorage persistence', () => {
  const KEY = 'test-table';

  function storedState(key = KEY) {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }

  it('persists sort, filters, hidden and widths under a v1 payload', () => {
    renderTable({ storageKey: KEY });
    const menu = openHeaderMenu('Name');
    fireEvent.click(within(menu).getByLabelText('alpha'));
    fireEvent.click(within(menu).getByText('Done'));
    const sortMenu = openHeaderMenu('Score');
    fireEvent.click(within(sortMenu).getByText('Sort descending'));
    expect(storedState()).toMatchObject({
      v: 1,
      sort: { key: 'score', dir: 'desc' },
      stringFilters: { name: ['alpha'] },
      hidden: [],
    });
  });

  it('hydrates persisted state on a fresh mount', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        sort: { key: 'score', dir: 'asc' },
        numFilters: { score: { op: '>=', value: 10 } },
        stringFilters: {},
        textFilters: {},
        hidden: ['done'],
        widths: { score: 200 },
      }),
    );
    renderTable({ storageKey: KEY });
    expect(rowIds()).toEqual(['r1', 'r4']);
    expect(screen.getByText('Showing 2 of 4 rows')).toBeDefined();
    expect(screen.queryByRole('button', { name: /^Done/ })).toBeNull();
  });

  it('normalizes legacy single-string stringFilters on load', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        stringFilters: { name: 'alpha', desc: '', id: null },
      }),
    );
    renderTable({ storageKey: KEY });
    expect(rowIds()).toEqual(['r1']);
    // The persist effect re-writes the normalized shape.
    expect(storedState().stringFilters).toEqual({
      name: ['alpha'],
      desc: null,
      id: null,
    });
  });

  it('falls back to defaults on corrupted JSON without crashing', () => {
    window.localStorage.setItem(KEY, '{not json');
    renderTable({ storageKey: KEY });
    expect(rowIds()).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('ignores payloads with an unknown version', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ v: 2, stringFilters: { name: ['alpha'] } }),
    );
    renderTable({ storageKey: KEY });
    expect(rowIds()).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('does not clobber saved state with defaults on remount (hydration race)', () => {
    const saved = {
      v: 1,
      sort: null,
      numFilters: {},
      stringFilters: { name: ['alpha'] },
      textFilters: {},
      hidden: [],
      widths: { score: 240 },
    };
    window.localStorage.setItem(KEY, JSON.stringify(saved));
    const first = renderTable({ storageKey: KEY });
    expect(storedState()).toMatchObject({
      stringFilters: { name: ['alpha'] },
      widths: { score: 240 },
    });
    first.unmount();
    renderTable({ storageKey: KEY });
    expect(storedState()).toMatchObject({
      stringFilters: { name: ['alpha'] },
      widths: { score: 240 },
    });
  });

  it('does not write the old key when storageKey changes mid-flight', () => {
    window.localStorage.setItem(
      'key-b',
      JSON.stringify({ v: 1, stringFilters: { name: ['gamma'] } }),
    );
    const view = renderTable({ storageKey: 'key-a' });
    const menu = openHeaderMenu('Name');
    fireEvent.click(within(menu).getByLabelText('alpha'));
    fireEvent.click(within(menu).getByText('Done'));
    expect(storedState('key-a').stringFilters).toEqual({ name: ['alpha'] });
    view.rerender(
      <ThemeProvider theme={light}>
        <DataTable<Row>
          rows={ROWS}
          columns={COLUMNS}
          getRowKey={(r) => r.id}
          storageKey="key-b"
        />
      </ThemeProvider>,
    );
    // key-b's saved filter wins for the new key…
    expect(rowIds()).toEqual(['r4']);
    // …and key-a's saved state is untouched by the swap.
    expect(storedState('key-a').stringFilters).toEqual({ name: ['alpha'] });
  });
});

describe('DataTable column resize', () => {
  it('drag persists a width clamped to the 50px minimum', () => {
    renderTable({ storageKey: 'resize-table' });
    const handle = screen.getByTitle('Drag to resize Score');
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 220 });
    fireEvent.mouseUp(document);
    expect(
      JSON.parse(window.localStorage.getItem('resize-table') ?? '{}').widths.score,
    ).toBe(120);
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 110 });
    fireEvent.mouseUp(document);
    expect(
      JSON.parse(window.localStorage.getItem('resize-table') ?? '{}').widths.score,
    ).toBe(50);
  });

  it('double-click resets the column to the minimum width', () => {
    renderTable({ storageKey: 'resize-table' });
    const handle = screen.getByTitle('Drag to resize Score');
    fireEvent.doubleClick(handle);
    expect(
      JSON.parse(window.localStorage.getItem('resize-table') ?? '{}').widths.score,
    ).toBe(50);
  });
});
