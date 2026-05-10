/// <reference path="../pb_data/types.d.ts" />

// Tighten reviewComments.deleteRule so an editor can only delete their
// own comments. Original rule allowed any authenticated user to delete
// any comment; switching to authorEmail = @request.auth.email prevents
// editors from clobbering each other's threads.

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('reviewComments');
    col.deleteRule =
      "@request.auth.id != '' && authorEmail = @request.auth.email";
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('reviewComments');
    col.deleteRule = "@request.auth.id != ''";
    app.save(col);
  },
);
