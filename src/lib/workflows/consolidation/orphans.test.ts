import { describe, expect, it } from 'vitest';
import { computeBacklogOrphans } from './orphans';

describe('computeBacklogOrphans', () => {
  it('flags backlog rows whose key is no longer produced', () => {
    const orphans = computeBacklogOrphans(
      [
        { articleKey: 'art-A', type: 'new', status: 'in-progress', assigneeEmail: 'a@x' },
        { articleKey: 'art-B', type: 'new', status: 'unassigned' },
        { articleKey: 'upd::eid-1', type: 'update', draftFolderUrl: 'https://drive/x' },
      ],
      new Set(['art-A', 'upd::eid-1']),
    );

    expect(orphans).toEqual([
      {
        articleKey: 'art-B',
        type: 'new',
        status: 'unassigned',
        assigneeEmail: undefined,
        hasDraftFolder: false,
      },
    ]);
  });

  it('returns nothing when every key still has output', () => {
    const orphans = computeBacklogOrphans(
      [{ articleKey: 'art-A', type: 'new' }],
      new Set(['art-A']),
    );
    expect(orphans).toEqual([]);
  });

  it('ignores rows with an empty key and surfaces draft/assignee signals', () => {
    const orphans = computeBacklogOrphans(
      [
        { articleKey: '', type: 'new' },
        {
          articleKey: 'upd::gone',
          type: 'update',
          status: 'drafting',
          assigneeEmail: 'b@x',
          draftFolderUrl: 'https://drive/y',
        },
      ],
      new Set<string>(),
    );

    expect(orphans).toEqual([
      {
        articleKey: 'upd::gone',
        type: 'update',
        status: 'drafting',
        assigneeEmail: 'b@x',
        hasDraftFolder: true,
      },
    ]);
  });
});
