# Changelog

## 0.1.0

First release.

- **Highlighting** for `.vasc` files and section sources (`src/sections/<name>/body.html`): output, tags, comments, whitespace control, filters and named arguments, markup inside HTML attributes, `<style>` and `<script>`, and the `{% schema %}` block as JSON.
- **Editing:** bracket matching, auto-closing, comment toggling, folding, and snippets for every tag, a section, a theme block and a setting.
- **Section schema validation** as you type, generated from the theme author contract (`tringify theme contract`): errors for what an upload rejects, warnings for likely mistakes (`vascula.schemaHints`).
- **Completion and hovers** for schema fields, setting types and `ctx_needs` names; Vascula and Tringify filters; tags; hosted form kinds and their fields; setting ids; and CTX fields.
- **Theme files:** JSON validation and completion for `theme.json`, templates and style templates, `config/settings_schema.json`, presets, metafield definitions and `src/sections/*/schema.json`.
