/**
 * Placeholder prompt exports for the consolidation stages.
 *
 * The real prompts have not been authored yet — phase_2.md flagged these
 * three stages as "fill in once the user hands over LLM definitions", and
 * the n8n workflow folder has nothing labelled "consolidation" (the
 * `content_generation/` flow is article-writing, not consolidation).
 *
 * Until the prompts arrive, the runners in this folder produce real but
 * un-LLM'd output: per-category aggregation + dedup-by-title of the
 * suggestion blobs the mapping step already wrote per code. Swapping in
 * the LLM call is the only thing left when the prompts land.
 */

export const TODO_CONSOLIDATE_PRIMARY_PROMPT = `
TODO — PRIMARY CONSOLIDATION PROMPT
Inputs (per category):
  - list of mapped codes (code, description, category)
  - each code's newArticlesNeeded[] (LLM mapping output)
  - each code's existingArticleUpdates[] (LLM mapping output)
Outputs:
  - newArticleSuggestions: dedup'd article-title candidates with attached codes
  - articleUpdateSuggestions: dedup'd section-update candidates with attached codes
Replace this stub when the real prompt is authored.
`.trim();

export const TODO_CONSOLIDATE_ARTICLES_SECONDARY_PROMPT = `
TODO — ARTICLES-SECONDARY PROMPT
Inputs:
  - all newArticleSuggestions for the specialty (output of primary, per category)
  - the specialty's existing consolidatedArticles (for delta-driven re-runs)
Outputs:
  - consolidatedArticles: specialty-wide dedup'd new-article candidates.
Replace this stub when the real prompt is authored.
`.trim();

export const TODO_CONSOLIDATE_SECTIONS_SECONDARY_PROMPT = `
TODO — SECTIONS-SECONDARY PROMPT
Inputs:
  - all articleUpdateSuggestions for the specialty
  - the specialty's existing consolidatedSections
Outputs:
  - consolidatedSections: specialty-wide dedup'd section-update candidates.
Replace this stub when the real prompt is authored.
`.trim();
