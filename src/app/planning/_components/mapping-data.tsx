import {
  listCategoryOrchestration,
  listSourceCategoryProgress,
} from '@/lib/data/categories';
import { listCodeLitSearchRuns } from '@/lib/data/code-lit-search-runs';
import { listCodeSources } from '@/lib/data/code-sources';
import {
  listCodeCount,
  listCodeTableRowsPage,
  listInFlightCodes,
} from '@/lib/data/codes';
import { getExtractionState } from '@/lib/data/pipeline';
import { getSpecialty } from '@/lib/data/specialties';
import { MappingView } from './mapping-view';

/**
 * Fetches everything the codes mapping table needs and renders it. Shared by the
 * Content Planner specialty mapping page and the Teaching curriculum mapping
 * page. `MappingView` and its children are URL-agnostic, so no basePath is
 * needed here.
 */
export async function MappingData({ slug }: { slug: string }) {
  const [
    firstPage,
    rows,
    sourceRows,
    codeSources,
    codeCount,
    extraction,
    specialty,
    litSearchRuns,
    inFlightCodes,
  ] = await Promise.all([
    listCodeTableRowsPage(slug, 1, 200),
    listCategoryOrchestration(slug),
    listSourceCategoryProgress(slug),
    listCodeSources(),
    listCodeCount(slug),
    getExtractionState(slug),
    getSpecialty(slug),
    listCodeLitSearchRuns(slug),
    listInFlightCodes(slug),
  ]);

  return (
    <MappingView
      slug={slug}
      initialCodes={firstPage.items}
      initialHasMore={firstPage.hasMore}
      rows={rows}
      sourceRows={sourceRows}
      codeSources={codeSources.map((s) => ({ slug: s.slug, name: s.name }))}
      codeCount={codeCount}
      extractionState={extraction.extract_codes}
      mappingOnly={specialty?.mappingOnly ?? false}
      mappingSource={specialty?.mappingSource ?? 'amboss'}
      pipelineMode={specialty?.pipelineMode ?? 'full'}
      initialLitSearchRuns={litSearchRuns}
      initialInFlightCodes={inFlightCodes}
    />
  );
}
