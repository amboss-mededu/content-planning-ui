'use client';

import { useEffect, useRef, useState } from 'react';

const POLL_MS = 3000;

/**
 * Live set of codes currently being (re)mapped, by polling the cookie-authed
 * `/in-flight` endpoint. Polling — not a PocketBase realtime subscription —
 * because the browser PB client is anonymous (the auth cookie is HttpOnly) and
 * so receives no realtime events. Seeded from the server snapshot and re-seeded
 * whenever the parent passes a fresh `initial` (e.g. after `router.refresh()`).
 */
export function useInFlightCodes(slug: string, initial: string[]): string[] {
  const [codes, setCodes] = useState<string[]>(initial);
  const initialRef = useRef(initial);

  useEffect(() => {
    if (initialRef.current !== initial) {
      initialRef.current = initial;
      setCodes(initial);
    }
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/codes/${encodeURIComponent(slug)}/in-flight`, {
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { codes: string[] };
        if (!cancelled) setCodes(data.codes);
      } catch {
        /* keep the last known set; next tick retries */
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug]);

  return codes;
}
