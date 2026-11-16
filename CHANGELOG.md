# Changelog

## 0.2.0 (2026-11-17)

- Schemas, CTX names and setting types follow the theme author contract of theme tools v0.1.75 (`tringify theme contract`). Canvas, the default theme, now shows no diagnostics; before, 199 false ones in 77 files.
- New in section schemas: `migrations`, `preview_image`, `blocks.theme_blocks`, `visible_if` with `set`, the `datetime`, `metafield` (with `owner`), `point` (with `image`) and `product_source` setting types, and ten new CTX roots (`age_gate`, `express`, `design_mode`, `theme_preview`, …). `review_notice` is no longer a CTX root.
- Setting rules apply only to settings with an `editor` block, as on upload; settings without one are runtime data. A block type needs at least one setting with an editor block. JSON types follow the platform (a string `min` is an error).
- `config/settings_schema.json`: the theme setting types (`css`, `font_picker`, `color_scheme_group`, …), `migrations`, and `schema_version` 1. A theme `range` no longer needs `min` and `max`.
- Style templates (`templates/styles/<style>/*.json`) are validated like `templates/*.json`.
- Filters: `slug`, `format_number` and `money_split`.
- Highlighting: `transition: background 0.2s` is no longer marked as a deprecated system colour, and `<a{% if url %} href="…"{% endif %}>` reads the markup as Vascula, not as part of the tag name.
- `npm test` fails when the schemas or filters disagree with the platform's structs and filter lists (`data/platform-fields.json`, written by `scripts/platform-fields.mjs`).

## 0.1.1

- Clearer description in the marketplaces. Contributor instructions moved to CONTRIBUTING.md.

## 0.1.0

First release.

- Syntax highlighting for `.vasc` files and section sources, with the `{% schema %}` block highlighted as JSON.
- Auto-closing, bracket matching, comment toggling, folding and snippets.
- Validation, completion and hovers for section schemas, generated from the theme author contract of theme tools v0.1.0.
- Completion and hovers for Vascula and Tringify filters, tags, hosted form kinds, setting ids and CTX fields.
- JSON validation for `theme.json`, templates, global settings, presets and metafield definitions.
