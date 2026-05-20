/**
 * Public types shared between server actions and client-side patch logic.
 * Kept out of `actions.ts` so client code (and unit tests) can import the
 * type without pulling in the server-only data layer.
 */
export type ApprovalActionResult = {
  articleReviewKeys: string[];
  sectionReviewKeys: string[];
  backlogKeys: string[];
};
