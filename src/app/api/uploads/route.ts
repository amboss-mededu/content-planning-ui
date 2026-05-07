/**
 * Upload a content-outline PDF into PocketBase.
 *
 * POST /api/uploads
 *   body: multipart/form-data with a single `file` field (application/pdf,
 *         <= 50 MB)
 *   200:  { url, name } — `url` is the public PB file URL the pipeline
 *         routes can later fetch as the source PDF
 *
 * Replaces the old @vercel/blob client-direct upload flow. The file streams
 * through this route into PocketBase via the admin client, which is the
 * cheapest way to keep the request authenticated against the user (cookie
 * scope) while still being able to write the `pipelineUploads` row that owns
 * the file (admin scope, since the row's `uploadedBy` is the resolved user).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/pb/server';

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'missing or invalid `file` field' },
      { status: 400 },
    );
  }
  if (file.type !== 'application/pdf') {
    return NextResponse.json(
      { error: 'only application/pdf is accepted' },
      { status: 415 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'file is empty' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file exceeds ${MAX_BYTES} bytes` },
      { status: 413 },
    );
  }

  const pb = await createAdminClient();
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('originalName', file.name);
  fd.append('uploadedBy', user._id);

  const record = await pb.collection('pipelineUploads').create(fd);
  // PB stores the file under a hashed name; fileToken-free public URL works
  // because the collection's createRule already required auth, and the file
  // route has no per-request restriction by default. (We can layer a token
  // on later if we ever want time-limited access.)
  const filename = (record as { file?: string }).file ?? file.name;
  const url = `${pb.baseURL.replace(/\/$/, '')}/api/files/${record.collectionId}/${record.id}/${filename}`;

  return NextResponse.json({ url, name: file.name });
}
