/**
 * Normalization + display helpers for the curriculum-mapping time dimension.
 *
 * `normalizeCurriculumMeta` is the single source of coercion truth: the
 * curriculum extract prompt returns a loosely-typed `curriculum` object (the
 * model may emit numbers as strings, stray casing on `cadence`, etc.), and this
 * whitelists/coerces it into a clean {@link CurriculumMeta}. It never invents
 * values — only what the model provided survives.
 *
 * Pure module (no server/client-only deps): the normalizer runs in the
 * extraction step, the formatters render in the mapping sheet + detail modal.
 */

import type { CurriculumCadence, CurriculumMeta } from '@/lib/types';

const CADENCES: readonly CurriculumCadence[] = ['weekly', 'monthly', 'longitudinal'];

function coerceNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function coerceString(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

/**
 * Coerce a raw `curriculum` object (from the extract model) into a clean
 * {@link CurriculumMeta}, or `undefined` when nothing usable is present.
 */
export function normalizeCurriculumMeta(raw: unknown): CurriculumMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: CurriculumMeta = {};

  const year = coerceNumber(r.year);
  // Sanity clamp — guard against the model echoing a calendar year (e.g. 2026)
  // into the program-year field. Real programs are a handful of years long.
  if (year !== undefined && year >= 1 && year <= 12) out.year = Math.round(year);

  const phase = coerceString(r.phase);
  if (phase) out.phase = phase;

  const startMonth = coerceString(r.startMonth);
  if (startMonth) out.startMonth = startMonth;

  const endMonth = coerceString(r.endMonth);
  if (endMonth) out.endMonth = endMonth;

  const durationWeeks = coerceNumber(r.durationWeeks);
  if (durationWeeks !== undefined && durationWeeks > 0) out.durationWeeks = durationWeeks;

  const durationLabel = coerceString(r.durationLabel);
  if (durationLabel) out.durationLabel = durationLabel;

  const cadence = coerceString(r.cadence)?.toLowerCase();
  if (cadence && (CADENCES as readonly string[]).includes(cadence)) {
    out.cadence = cadence as CurriculumCadence;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Calendar position of a block: "Sep–Nov" when both months are present, the
 * single month when only one is, else "—". Duration/cadence is shown
 * separately by {@link formatDurationOrCadence}.
 */
export function formatTimeframe(meta: CurriculumMeta | undefined | null): string {
  if (!meta) return '—';
  if (meta.startMonth && meta.endMonth) return `${meta.startMonth}–${meta.endMonth}`;
  if (meta.startMonth) return meta.startMonth;
  if (meta.endMonth) return meta.endMonth;
  return '—';
}

/**
 * How long / how often: an explicit week count, else the verbatim duration
 * label (also covers program-relative spans like "Month 1–6"), else the
 * longitudinal cadence, else "—".
 */
export function formatDurationOrCadence(meta: CurriculumMeta | undefined | null): string {
  if (!meta) return '—';
  if (meta.durationWeeks)
    return `${meta.durationWeeks} wk${meta.durationWeeks === 1 ? '' : 's'}`;
  if (meta.durationLabel) return meta.durationLabel;
  if (meta.cadence) return meta.cadence;
  return '—';
}
