import { redirect } from 'next/navigation';

/**
 * The standalone "Categories" tab was merged into the "Mapping" tab — its
 * consolidation-bucket and source-category views now live behind the Mapping
 * view selector. Keep this route as a redirect so existing bookmarks and open
 * tabs land on the consolidation-buckets view instead of 404ing.
 */
export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty } = await params;
  redirect(`/planning/${specialty}/mapping?view=consolidation`);
}
