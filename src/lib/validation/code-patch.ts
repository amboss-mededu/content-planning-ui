/**
 * Strict request-body schema for `PATCH /api/codes/[specialty]/[code]`.
 *
 * Lives in `lib/` (not in the route file) so it can be unit-tested in
 * isolation and reused as the source of truth for the editable field set
 * shared by the route handler and `patchCode` in `lib/data/codes.ts`.
 *
 * Only Zod is imported here — safe to load from both server and test code.
 * The schema is `.strict()`: an unknown top-level key is a 400, so a stale
 * client (or a typo) can never silently write a field the editor doesn't own.
 */

import { z } from 'zod';
import { ALL_COVERAGE_LEVELS } from '@/lib/types';

const SectionRefSchema = z
  .object({
    sectionTitle: z.string().optional(),
    sectionId: z.string().optional(),
  })
  .strip();

export const CoveredSectionSchema = z
  .object({
    articleTitle: z.string().optional(),
    articleId: z.string().optional(),
    sections: z.array(SectionRefSchema).optional(),
  })
  .strip();

export const SectionUpdateSchema = z
  .object({
    articleTitle: z.string().optional(),
    articleId: z.string().optional(),
    sections: z
      .array(
        z
          .object({
            sectionTitle: z.string().optional(),
            sectionId: z.string().optional(),
            exists: z.boolean().optional(),
            changes: z.string().optional(),
            importance: z.number().optional(),
          })
          .strip(),
      )
      .optional(),
  })
  .strip();

export const NewArticleSchema = z
  .object({
    articleTitle: z.string().optional(),
    importance: z.number().optional(),
  })
  .strip();

/**
 * Editable code fields. Scalars are all optional and individually omittable;
 * the route rejects a body that resolves to zero meaningful fields. The three
 * JSON arrays are full replacements (last-write-wins) — the server recomputes
 * the derived count columns from them, never trusting client-supplied counts.
 */
export const CodePatchBody = z
  .object({
    source: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    consolidationCategory: z.string().optional(),
    isInAMBOSS: z.boolean().optional(),
    coverageLevel: z.enum(ALL_COVERAGE_LEVELS).optional(),
    depthOfCoverage: z.number().min(0).optional(),
    notes: z.string().optional(),
    gaps: z.string().optional(),
    improvements: z.string().optional(),
    articlesWhereCoverageIs: z.array(CoveredSectionSchema).optional(),
    existingArticleUpdates: z.array(SectionUpdateSchema).optional(),
    newArticlesNeeded: z.array(NewArticleSchema).optional(),
  })
  .strict();

export type CodePatchInput = z.infer<typeof CodePatchBody>;

/** Scalar string fields that are pure metadata — editing them must NOT stamp
 *  `mappedAt`, since they carry no mapping verdict. */
export const METADATA_STRING_FIELDS = [
  'source',
  'description',
  'category',
  'consolidationCategory',
] as const;
