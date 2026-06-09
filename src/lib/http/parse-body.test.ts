import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseBody, parseBodyOr400 } from './parse-body';

const Schema = z.object({
  slug: z.string().min(1, 'slug required'),
  count: z.number().optional(),
});

// Minimal NextRequest stand-in: parseBody only calls `req.json()`.
function req(json: () => Promise<unknown>): NextRequest {
  return { json } as unknown as NextRequest;
}

async function statusAndBody(res: NextResponse) {
  return { status: res.status, body: await res.json() };
}

describe('parseBody', () => {
  it('returns ok with validated data on a valid body', async () => {
    const result = await parseBody(req(async () => ({ slug: 'cardio', count: 3 })), Schema);
    expect(result).toEqual({ ok: true, data: { slug: 'cardio', count: 3 } });
  });

  it('fails with a 400 carrying the first issue message', async () => {
    const result = await parseBody(req(async () => ({ slug: '' })), Schema);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(await statusAndBody(result.response)).toEqual({
      status: 400,
      body: { error: 'slug required' },
    });
  });

  it('treats a malformed body as {} and 400s rather than throwing', async () => {
    const result = await parseBody(
      req(async () => {
        throw new SyntaxError('Unexpected token');
      }),
      Schema,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.response.status).toBe(400);
  });
});

describe('parseBodyOr400', () => {
  it('returns the typed data on success', async () => {
    const body = await parseBodyOr400(req(async () => ({ slug: 'cardio' })), Schema);
    expect(body).toEqual({ slug: 'cardio' });
  });

  it('returns a NextResponse on failure', async () => {
    const body = await parseBodyOr400(req(async () => ({})), Schema);
    expect(body).toBeInstanceOf(NextResponse);
  });
});
