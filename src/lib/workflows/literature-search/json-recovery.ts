import type { z } from 'zod';

// Gemini in JSON-only mode (structuredOutputs: false) is prompt-guided, not
// schema-coerced. The AI SDK's `Output.array` wraps the JSON schema as
// `{ elements: [...] }`; if the model returns a bare top-level array (e.g.
// when the prompt drifts back toward "JSON array of strings"), the SDK
// rejects it with NoObjectGeneratedError. Recover by parsing `error.text`
// and accepting either shape.
export function recoverElementsFromText<T>(
  text: string | undefined,
  elementSchema: z.ZodType<T>,
): T[] | null {
  const rawArray = recoverRawElementsFromText(text);
  if (!rawArray) return null;
  const out: T[] = [];
  for (const r of rawArray) {
    const result = elementSchema.safeParse(r);
    if (result.success) out.push(result.data);
  }
  return out;
}

export function recoverRawElementsFromText(text: string | undefined): unknown[] | null {
  if (!text) return null;
  const candidates = stripJsonFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidates);
  } catch {
    return null;
  }
  const rawArray = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { elements?: unknown })?.elements)
      ? (parsed as { elements: unknown[] }).elements
      : null;
  if (!rawArray) return null;
  return rawArray;
}

export function describeJsonShape(text: string | undefined): string {
  if (!text) return 'empty';
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch {
    return 'invalid-json';
  }
  if (Array.isArray(parsed)) return `array:${parsed.length}`;
  if (parsed && typeof parsed === 'object') {
    const keys = Object.keys(parsed as Record<string, unknown>);
    const elements = (parsed as { elements?: unknown }).elements;
    if (Array.isArray(elements)) {
      return `object:${keys.join(',') || '(no-keys)'};elements:${elements.length}`;
    }
    return `object:${keys.join(',') || '(no-keys)'}`;
  }
  return typeof parsed;
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return withoutFence.trim();
}
