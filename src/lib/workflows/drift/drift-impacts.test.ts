import { describe, expect, it } from 'vitest';
import {
  buildDriftRefs,
  computeDriftImpacts,
  type DriftContentRef,
  type DriftEventInput,
} from './drift-impacts';

function event(over: Partial<DriftEventInput>): DriftEventInput {
  return {
    eventKey: 'e1',
    articleEid: 'A1',
    changeType: 'renamed',
    ...over,
  };
}

describe('computeDriftImpacts', () => {
  it('matches refs by articleEid and lists every event', () => {
    const refs: DriftContentRef[] = [
      { kind: 'article', articleEid: 'A1', label: 'Sepsis', hasDownstreamWork: true },
      { kind: 'code', articleEid: 'A1', code: 'D001', label: 'D001 — Sepsis code' },
      { kind: 'article', articleEid: 'A2', label: 'Shock' },
    ];
    const impacts = computeDriftImpacts(
      [event({ articleEid: 'A1' }), event({ eventKey: 'e2', articleEid: 'A9' })],
      refs,
    );
    expect(impacts).toHaveLength(2);
    expect(impacts[0].refs.map((r) => r.kind).sort()).toEqual(['article', 'code']);
    expect(impacts[0].touchesDownstreamWork).toBe(true);
    // Event for an eid nobody references is still surfaced, with no refs.
    expect(impacts[1].refs).toHaveLength(0);
    expect(impacts[1].touchesDownstreamWork).toBe(false);
  });

  it('section-scoped event only matches the named section, but still its article/code refs', () => {
    const refs: DriftContentRef[] = [
      { kind: 'section', articleEid: 'A1', sectionId: 'S1', label: 'A1 › Intro' },
      { kind: 'section', articleEid: 'A1', sectionId: 'S2', label: 'A1 › Tx' },
      { kind: 'article', articleEid: 'A1', label: 'A1' },
      { kind: 'code', articleEid: 'A1', code: 'C', label: 'C' },
    ];
    const [impact] = computeDriftImpacts(
      [event({ sectionId: 'S1', changeType: 'moved' })],
      refs,
    );
    const kinds = impact.refs.map((r) => `${r.kind}:${r.sectionId ?? ''}`).sort();
    // S2 is excluded; S1 + the article + the code remain.
    expect(kinds).toEqual(['article:', 'code:', 'section:S1']);
  });
});

describe('buildDriftRefs', () => {
  it('expands code article eids, skips new articles without an eid, parses upd:: backlog keys', () => {
    const refs = buildDriftRefs({
      codes: [{ code: 'D1', description: 'desc', articleEids: ['A1', 'A2', ''] }],
      articles: [
        { articleKey: 'k-new', articleTitle: 'Brand new', approved: true }, // no articleId → skipped
        {
          articleKey: 'k-a3',
          articleId: 'A3',
          articleTitle: 'Existing',
          approved: false,
        },
      ],
      sections: [
        {
          sectionKey: 's-1',
          articleId: 'A1',
          sectionId: 'S1',
          articleTitle: 'Sepsis',
          sectionName: 'Therapy',
          approved: true,
        },
      ],
      backlog: [
        { articleKey: 'upd::A4', articleTitle: 'Update me' },
        { articleKey: 'plain-new-key' }, // not an update key → skipped
        { articleKey: 'upd::' }, // empty eid → skipped
      ],
    });

    // 2 code refs (empty eid dropped), 1 article (new skipped), 1 section, 1 backlog.
    expect(refs.filter((r) => r.kind === 'code')).toHaveLength(2);
    expect(refs.filter((r) => r.kind === 'article')).toHaveLength(1);
    expect(refs.find((r) => r.kind === 'article')?.articleEid).toBe('A3');
    const section = refs.find((r) => r.kind === 'section');
    expect(section?.sectionId).toBe('S1');
    expect(section?.label).toBe('Sepsis › Therapy');
    expect(section?.hasDownstreamWork).toBe(true);
    const backlog = refs.filter((r) => r.kind === 'backlog');
    expect(backlog).toHaveLength(1);
    expect(backlog[0].articleEid).toBe('A4');
    expect(backlog[0].hasDownstreamWork).toBe(true);
  });
});
