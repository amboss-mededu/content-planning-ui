/// <reference path="../pb_data/types.d.ts" />

// Raise extractedCodes.category / consolidationCategory to unlimited (max 0).
// They were capped at 200, but the extraction LLM emits longer category labels
// ("<name> | <clarifying description>"); a single over-long row made the whole
// extract_codes write throw the generic "Failed to create record", failing the
// run so it never reached awaiting_approval (milestones, which writes one
// string, was unaffected). The canonical `codes.category` is already unlimited.

migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1152346459")

  // update field
  collection.fields.addAt(4, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text105650625",
    "max": 0,
    "min": 0,
    "name": "category",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // update field
  collection.fields.addAt(5, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2909516303",
    "max": 0,
    "min": 0,
    "name": "consolidationCategory",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1152346459")

  // update field
  collection.fields.addAt(4, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text105650625",
    "max": 200,
    "min": 0,
    "name": "category",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // update field
  collection.fields.addAt(5, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2909516303",
    "max": 200,
    "min": 0,
    "name": "consolidationCategory",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
})
