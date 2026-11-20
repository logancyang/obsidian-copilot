# Intelligent UI block body contract

`parseIntelligentUi` accepts the body of a `copilot-ui` fence. Callers identify
fences themselves; this module does not recognize markup elsewhere in a note.
It has no React, Obsidian, DOM, or Markdown-rendering dependency.

The result is deeply frozen. `status: "error"` rejects the whole block and
contains only a typed error with a zero-based UTF-16 offset and one-based line
and column. No partial tree accompanies an error.

A valid prefix returns `status: "pending"` with a pending offset. Its tree keeps
open ancestors marked `complete: false`, completed descendants marked
`complete: true`, and any plain text already received. An unfinished opening
tag is withheld until its closing `>` arrives. A closed prefix may return
`complete` even when more siblings will subsequently arrive. Consumers must
use the enclosing fence/stream lifecycle to know whether generation has ended.

`UI_SCHEMA` is the persisted vocabulary and the single source for its model
guidance: each primitive carries the description, props and nesting rules the
prompt states. Layout containers accept elements; `steps` and `tabs` accept only
their `step` and `tab` items, which require that parent. `callout.tone` accepts
only `CALLOUT_TONES`. Text-bearing
primitives accept plain text only. A `step` accepts either plain text or child
elements; mixing both is rejected to preserve content order. `markdown` preserves Markdown links and
wikilinks verbatim for a later ordinary Markdown renderer. No entities are
decoded. Unknown tags, props, icons, duplicate props, expressions in props,
entities, invalid nesting, and mismatched closing tags reject the whole block.
Literal `<` starts a tag, including inside `markdown`; use ordinary Markdown
links rather than angle-bracket autolinks or HTML. Prop strings use either quote style; only `columns` also accepts an unquoted
number. `SUPPORTED_ICONS` is the fixed supported Lucide-name allowlist.

Limits are fixed at 12 element levels, 256 elements, 32,768 UTF-16 units of
combined body/prop text, and 65,536 source units. These allow substantial answers
while bounding recursive snapshots and scanning, including unfinished tokens.
Reaching a limit is valid; exceeding it returns its typed limit error.

`testing/golden.ts` supplies comparison, steps, metrics, grouped-concepts and
architecture fixtures for the renderer, integration and evaluation steps.
