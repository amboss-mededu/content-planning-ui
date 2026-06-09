/**
 * Shared JSON request-body parsing for API route handlers.
 *
 * Replaces the scattered `(await req.json().catch(() => ({}))) as Body` idiom,
 * which silently turned malformed/empty bodies into `{}` and then surfaced as
 * cryptic `undefined` reads downstream. These helpers keep the same tolerance
 * (a malformed body never throws) but validate against a zod schema and return
 * a `400 { error }` with a real message instead.
 *
 * Two shapes, matching how the routes are already written:
 *   - `parseBody`      → discriminated result, branch on `.ok`.
 *   - `parseBodyOr400` → returns the typed body OR a NextResponse to early-return,
 *                        mirroring the `requireUserResponse` guard idiom:
 *                          const body = await parseBodyOr400(req, Schema);
 *                          if (body instanceof NextResponse) return body;
 */

import { type NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

export async function parseBody<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
): Promise<ParseResult<z.infer<S>>> {
  const raw = await req.json().catch(() => ({}));
  const result = schema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? 'invalid request body';
    return {
      ok: false,
      response: NextResponse.json({ error: message }, { status: 400 }),
    };
  }
  return { ok: true, data: result.data };
}

export async function parseBodyOr400<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
): Promise<z.infer<S> | NextResponse> {
  const parsed = await parseBody(req, schema);
  return parsed.ok ? parsed.data : parsed.response;
}
