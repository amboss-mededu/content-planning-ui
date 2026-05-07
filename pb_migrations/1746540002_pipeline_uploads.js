/// <reference path="../pb_data/types.d.ts" />

// PR 7 of the migration: replaces @vercel/blob with PocketBase file storage.
//
// Adds a `pipelineUploads` collection that stores user-uploaded PDFs (the
// "content outline" inputs to extract-codes / extract-milestones). The file
// itself lives in PocketBase's pb_data/storage/ tree; the public download URL
// is `<POCKETBASE_URL>/api/files/<collectionId>/<recordId>/<filename>`.
//
// Access:
//   - any authenticated user can create + read uploads (the app already
//     restricts who can sign in via the OAuth allowlist hook)
//   - no update/delete; PDFs are append-only artefacts of a pipeline run
//   - file size limit mirrors the old Vercel Blob 50 MB ceiling
//   - mime type restricted to application/pdf so the upload route doesn't have
//     to police it.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    app.save(
      new Collection({
        type: 'base',
        name: 'pipelineUploads',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: null,
        deleteRule: null,
        fields: [
          {
            type: 'file',
            name: 'file',
            required: true,
            maxSize: 50 * 1024 * 1024,
            maxSelect: 1,
            mimeTypes: ['application/pdf'],
          },
          { type: 'text', name: 'originalName', required: true, max: 500 },
          {
            type: 'relation',
            name: 'uploadedBy',
            required: true,
            collectionId: users.id,
            cascadeDelete: false,
            maxSelect: 1,
          },
        ],
      }),
    );
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('pipelineUploads');
      app.delete(col);
    } catch (_) {
      /* not present — ignore */
    }
  },
);
