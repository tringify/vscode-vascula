# Vascula for Tringify Themes

Editor support for [Vascula](https://vascula.dev) templates and [Tringify themes](https://dev-docs.tringify.com/themes/build-your-first-theme) in Visual Studio Code.

## Features

**Syntax highlighting for `.vasc` files.** HTML with Vascula output (`{{ }}`), tags (`{% %}`) and comments (`{# #}`, `{% comment %}`), including whitespace control (`{{-`, `-%}`), strings, numbers, operators, filters and named arguments. Markup is highlighted inside HTML attributes, `<style>` and `<script>`. The `{% schema %}` block is highlighted as JSON. Section sources at `src/sections/<name>/body.html` open as Vascula too.

**Editing.** Bracket matching and auto-closing for `{{ }}`, `{% %}` and `{# #}`, comment toggling with `{# #}`, folding for block tags, and snippets for every tag plus a complete section, a theme block and a setting.

**Section schema validation.** The `{% schema %}` block of each section and theme block is checked as you type:

- **Errors** for what an upload rejects: a missing `name`, an unsupported setting type or `kind`, an unknown `ctx_needs` name, a `range` without `min` and `max`, an empty `visible_if`, invalid JSON, or more than one schema block.
- **Warnings** for likely mistakes: unknown keys (often a typo such as `defualt`), duplicate setting ids, `select` without `options`, `visible_if` naming a setting that does not exist, presets naming undeclared settings or blocks, and `{% blocks %}` in a section that accepts no theme or app blocks. Turn these off with `vascula.schemaHints`.

**Completion and hovers.**

- Inside the schema: every field, setting type and `ctx_needs` name, with documentation.
- After `|`: every Vascula built-in filter and Tringify's platform filters (`money`, `t`, `image_url`, `image_srcset`, `image_loading`, `asset_url`, `placeholder_svg`, `placeholder_video`), each with its arguments, behaviour and an example.
- After `{%`: tag names. Inside `{% form "` : the hosted form kinds and their fields.
- After `settings.`: the section's setting ids. After a CTX root such as `product.` or `cart.items.first.`: its fields and types.
- Hover a filter or a CTX root for its documentation. Hovering a root the section does not declare reminds you to add it to `ctx_needs`.

**Theme files.** JSON validation and completion for `theme.json`, `templates/*.json`, `config/settings_schema.json`, `config/presets/*.json`, `config/metafields.json` and `src/sections/*/schema.json`. Files from other platforms that share these names, such as a WordPress `theme.json`, are left alone.

## Before you upload

The checks follow the same rules uploads are checked against and the [theme documentation](https://dev-docs.tringify.com/themes/section-schema). Run `tringify theme check` before you upload: it also checks that the markup compiles and that every name a section reads is declared.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `vascula.validateSectionSchema` | `true` | Validate `{% schema %}` blocks. |
| `vascula.schemaHints` | `true` | Also show the warnings for likely mistakes described above. |

Emmet is not enabled for Vascula by default. To use it, add `"emmet.includeLanguages": { "vascula": "html" }` to your settings.

## License

[MIT](LICENSE)
