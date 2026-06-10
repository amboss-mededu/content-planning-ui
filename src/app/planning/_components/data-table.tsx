'use client';

// Barrel for the DataTable family. The 2,300-line monolith that used to live
// here was split into ./data-table/* (state hooks, header/menu/filter/cell
// components, plain + virtualized bodies) with no behavior change; this file
// preserves the public import path so the ~7 consumers keep importing
// { DataTable, type Column } from './data-table' unchanged.

export { DataTable } from './data-table/data-table-root';
export type { Column, ColumnGroup, EditableConfig } from './data-table/types';
