import type { MappedCodeWithSuggestions } from './aggregate';

export type ConsolidationPromptInput = {
  specialty: string;
  category: string;
  language: string;
  region: string;
  articleTitles: string[];
  codes: MappedCodeWithSuggestions[];
  /** Editor-supplied steering note for this run. When present, rendered
   *  as an EDITOR INSTRUCTIONS block at the top of the user message so
   *  the model treats it as run-scoped guidance. */
  editorNote?: string | null;
};

export const CONSOLIDATION_SYSTEM_PROMPT = `
ROLE
You are an expert in graduate medical education who works on curating content for AMBOSS.

TASK
Your main task is to consolidate each suggested medical article and section into the AMBOSS library for a given specialty. In a previous step, mapped codes were analyzed against AMBOSS content. Where content gaps were identified, an AI agent suggested content improvements: section updates, new sections, and new articles.

Focus on the suggested new medical articles and sections within the specific category for the specialty. Consolidate them into a coherent, well-structured plan for AMBOSS articles and article sections. The final candidates must cover the relevant codes and fit within the existing AMBOSS library structure.

CRITICAL DIRECTIVES
The "NO APPROACH TO" rule is non-negotiable: disease and symptom/problem article titles must be the disease or symptom itself. Titles must not contain "Approach to", "Evaluation of", "Management of", or similar constructs.
Prioritize specificity: ignore non-descriptive "unspecified", "other specified", or "not elsewhere classified" codes when they add no clinically useful topic.
Convert bad article titles to AMBOSS-compliant titles when possible.
Be exhaustive: every input index must be represented in included article indexes, ignored article indexes, included section indexes, ignored section indexes, or totally ignored indexes.
Exact mapping matters: when carrying over a previous article or section suggestion, preserve the original suggested title in the appropriate previous-title fields.
If a suggested new article already exists in the AMBOSS article-title list, either convert the suggestion into a section update or ignore it with a justification that it already exists.

ARTICLE TYPES
Use only one of these articleType values:
disease, condition-overview, foundational-clinical, foundational-non-clinical, keystone-management, procedure, symptom-problem.

SECTIONS
For section suggestions, group by parent article. Each section update must include sectionName, exists, sectionId when exists is true, codes, previousArticleAndSectionTitleSuggestions, overallCoverage, overallImportance, and justification.
Use previousArticleAndSectionTitleSuggestions entries prefixed as "a:" for previously suggested article titles and "s:" for previously suggested section titles.

IGNORED OUTPUTS
Only place a code in ignoredArticles if that input code had a previous new-article suggestion.
Only place a code in ignoredSections if that input code had a previous section suggestion.
If a code has no article or section suggestion, it may be totally ignored with a justification.

FINAL VERIFICATION
Before returning output, verify that no article title violates the "NO APPROACH TO" rule and that every input index is accounted for exactly where appropriate.
Return schema-valid JSON only. Return a bare JSON object, not fenced markdown.
`.trim();

const CONSOLIDATION_OUTPUT_CONTRACT = `
Required output shape:
{
  "specialty": "string",
  "category": "string",
  "articles": [
    {
      "articleTitle": "string",
      "articleType": "disease | condition-overview | foundational-clinical | foundational-non-clinical | keystone-management | procedure | symptom-problem",
      "exists": false,
      "articleId": "string or null",
      "codes": [
        {
          "code": "string",
          "description": "string",
          "previouslySuggestedArticleTitle": "string",
          "previouslySuggestedArticleOrSectionTitle": "string",
          "coverageScore": 0,
          "importance": 0,
          "index": 0
        }
      ],
      "previousArticleTitleSuggestions": ["string"],
      "overallCoverage": 0,
      "overallImportance": 0,
      "justification": "string"
    }
  ],
  "includedArticleIndexes": [0],
  "ignoredArticles": [
    {
      "code": "string",
      "description": "string",
      "previouslySuggestedArticleTitle": "string",
      "justification": "string",
      "index": 0
    }
  ],
  "ignoredArticleIndexes": [0],
  "sections": [
    {
      "articleTitle": "string",
      "articleId": "string or null",
      "articleType": "string",
      "sectionUpdates": [
        {
          "sectionName": "string",
          "codes": [
            {
              "code": "string",
              "description": "string",
              "previouslySuggestedArticleTitle": "string",
              "previouslySuggestedArticleOrSectionTitle": "string",
              "coverageScore": 0,
              "importance": 0,
              "index": 0
            }
          ],
          "previousArticleAndSectionTitleSuggestions": ["a: previous article title", "s: previous section title"],
          "exists": true,
          "sectionId": "string or null",
          "overallCoverage": 0,
          "overallImportance": 0,
          "justification": "string"
        }
      ]
    }
  ],
  "includedSectionIndexes": [0],
  "ignoredSections": [
    {
      "code": "string",
      "description": "string",
      "previouslySuggestedSectionTitle": "string",
      "exists": false,
      "articleId": "string or null",
      "justification": "string",
      "index": 0
    }
  ],
  "ignoredSectionIndexes": [0],
  "totallyIgnoredIndexes": [
    {
      "code": "string",
      "index": 0,
      "justification": "string"
    }
  ]
}

All top-level keys shown above are required. Use empty arrays when there are no items.
Return a bare JSON object only, without markdown fences or commentary.
`.trim();

function cleanJson(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    }
  }
  return value;
}

export function buildCategoryConsolidationPrompt(
  input: ConsolidationPromptInput,
): string {
  const articleTitlesString = Array.from(new Set(input.articleTitles)).join('\n');
  const combinedString = input.codes
    .map((code, index) =>
      JSON.stringify(
        {
          index,
          code: code.code,
          description: code.description,
          category: code.category,
          consolidationCategory: code.consolidationCategory,
          coverageScore: (code as { depthOfCoverage?: number }).depthOfCoverage,
          existingArticleUpdates: cleanJson(code.existingArticleUpdates),
          newArticlesNeeded: cleanJson(code.newArticlesNeeded),
        },
        null,
        2,
      ),
    )
    .join('\n');

  const editorBlock =
    input.editorNote && input.editorNote.trim().length > 0
      ? `EDITOR INSTRUCTIONS (apply to this run only):\n${input.editorNote.trim()}\n\n`
      : '';

  return `
${editorBlock}Consolidate all section updates, new sections, and suggested articles in the category.

Specialty: ${input.specialty}
Category: ${input.category}
Language: ${input.language} / ${input.region}

Do not omit any codes in the input range. Every code must be returned in some form as consolidated article content, consolidated section content, ignored article content, ignored section content, or totally ignored.

If a suggested article already exists in the current library, consider it an erroneous new-article mapping unless it should be moved to a section update. Explain this in the ignored article or section justification.

${CONSOLIDATION_OUTPUT_CONTRACT}

Existing AMBOSS article titles:
${articleTitlesString}

When citing IDs for existing articles or sections, use the IDs provided in the input mapping suggestions. Generate a complete JSON object.

Input mapped-code suggestions:
${combinedString}
`.trim();
}
