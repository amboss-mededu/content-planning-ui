/**
 * Thin wrapper around NCBI's E-utilities for PubMed candidate fetching.
 *
 * Two calls per query:
 *   1. `esearch.fcgi` — translates a query into a list of PMIDs.
 *   2. `esummary.fcgi` — fleshes out each PMID with title / authors /
 *      journal / DOI metadata.
 *
 * NCBI rate limits: 3 req/sec anonymous, 10 req/sec with `NCBI_API_KEY`.
 * The client paces sequential requests to the appropriate floor; when
 * an article generates several queries this prevents bursts from
 * tripping NCBI's per-IP limit. Calls are deduplicated by PMID across
 * an article's queries so the ranker doesn't see the same paper twice.
 */

import { env } from '@/env';

const ESEARCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
const ESUMMARY = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';

// NCBI publishes 3/s (anon) and 10/s (keyed) but enforces with a rolling
// window that bites when bursts straddle the second boundary. We pace
// well under the cap to leave headroom.
const MIN_GAP_KEYED_MS = 150;
const MIN_GAP_ANON_MS = 500;
const RETRY_429_BACKOFF_MS = [1000, 2500, 5000];

let lastRequestAt = 0;
async function pace(): Promise<void> {
  const gap = env.NCBI_API_KEY ? MIN_GAP_KEYED_MS : MIN_GAP_ANON_MS;
  const now = Date.now();
  const wait = lastRequestAt + gap - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function appendApiKey(url: string): string {
  if (!env.NCBI_API_KEY) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}api_key=${encodeURIComponent(env.NCBI_API_KEY)}`;
}

export type PubmedCandidate = {
  pmid: string;
  title: string;
  authors: string[];
  journal: string;
  journalNlm?: string;
  year?: number;
  doi?: string;
  url: string;
};

type EsearchResponse = {
  esearchresult?: {
    idlist?: string[];
  };
};

type EsummaryRecord = {
  uid?: string;
  title?: string;
  authors?: Array<{ name?: string; authtype?: string }>;
  source?: string;
  fulljournalname?: string;
  pubdate?: string;
  articleids?: Array<{ idtype?: string; value?: string }>;
};

type EsummaryResponse = {
  result?: Record<string, EsummaryRecord | string[]>;
};

async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await pace();
    const res = await fetch(appendApiKey(url), {
      headers: { Accept: 'application/json' },
      // NCBI sometimes responds slowly; default fetch timeout is fine here
      // because the worker tolerates per-article failure.
    });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 && attempt < RETRY_429_BACKOFF_MS.length) {
      // Drain the body so the connection can be reused, then back off
      // before the next pace()-gated retry.
      await res.text().catch(() => '');
      await new Promise((r) => setTimeout(r, RETRY_429_BACKOFF_MS[attempt]));
      continue;
    }
    throw new Error(`NCBI eutils ${res.status}: ${await res.text()}`);
  }
}

async function esearch(query: string, retmax: number): Promise<string[]> {
  const url = `${ESEARCH}?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&retmode=json`;
  const data = await fetchJson<EsearchResponse>(url);
  return data.esearchresult?.idlist ?? [];
}

async function esummary(pmids: string[]): Promise<EsummaryRecord[]> {
  if (pmids.length === 0) return [];
  const url = `${ESUMMARY}?db=pubmed&id=${pmids.join(',')}&retmode=json`;
  const data = await fetchJson<EsummaryResponse>(url);
  const result = data.result ?? {};
  const out: EsummaryRecord[] = [];
  for (const pmid of pmids) {
    const entry = result[pmid];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      out.push(entry);
    }
  }
  return out;
}

function parseYear(pubdate: string | undefined): number | undefined {
  if (!pubdate) return undefined;
  const m = pubdate.match(/\b(\d{4})\b/);
  return m ? Number.parseInt(m[1], 10) : undefined;
}

function extractDoi(ids: EsummaryRecord['articleids'] | undefined): string | undefined {
  if (!ids) return undefined;
  for (const id of ids) {
    if (id.idtype === 'doi' && id.value) return id.value;
  }
  return undefined;
}

function toCandidate(rec: EsummaryRecord): PubmedCandidate | null {
  const pmid = rec.uid;
  const title = rec.title;
  if (!pmid || !title) return null;
  const authors = (rec.authors ?? [])
    .filter((a) => a.authtype === 'Author' || !a.authtype)
    .map((a) => a.name)
    .filter((n): n is string => typeof n === 'string')
    .slice(0, 10);
  return {
    pmid,
    title,
    authors,
    journal: rec.source ?? rec.fulljournalname ?? '',
    journalNlm: rec.source,
    year: parseYear(rec.pubdate),
    doi: extractDoi(rec.articleids),
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  };
}

/**
 * Run each query against PubMed, dedupe by PMID, and return the union
 * with full per-paper metadata.
 */
export async function fetchPubmedCandidates(
  queries: string[],
  opts: { maxPerQuery?: number } = {},
): Promise<PubmedCandidate[]> {
  const maxPerQuery = opts.maxPerQuery ?? 25;
  const pmidSet = new Set<string>();
  for (const q of queries) {
    const trimmed = q.trim();
    if (!trimmed) continue;
    try {
      const ids = await esearch(trimmed, maxPerQuery);
      for (const id of ids) pmidSet.add(id);
    } catch (e) {
      // Best-effort per query — one failing query shouldn't kill the
      // whole search. Worker logs the error at the call site.
      console.warn('[pubmed] esearch failed', { query: trimmed, error: e });
    }
  }
  const pmids = [...pmidSet];
  if (pmids.length === 0) return [];
  // esummary accepts a comma-separated id list; chunk to keep URLs sane.
  const chunkSize = 100;
  const out: PubmedCandidate[] = [];
  for (let i = 0; i < pmids.length; i += chunkSize) {
    const chunk = pmids.slice(i, i + chunkSize);
    const records = await esummary(chunk);
    for (const rec of records) {
      const c = toCandidate(rec);
      if (c) out.push(c);
    }
  }
  return out;
}
