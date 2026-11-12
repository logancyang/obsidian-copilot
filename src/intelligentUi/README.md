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

## React renderer

`ui/IntelligentUi` renders a validated result and takes the unchanged original
source for its rejected-block code fallback. Callers supply `sourcePath` and an
`AppContext` provider; Markdown bodies use the existing Obsidian renderer and
own their component lifecycle. Plain text and attributes remain React text.
`registerIntelligentUiProcessor` registers one unconditional Markdown code-block
processor during plugin load. Obsidian supplies chat, Reading view and native
Live Preview integration; each React root belongs to a `MarkdownRenderChild`.
Generation preferences never disable rendering of saved blocks. Incomplete
bodies show their entire source, since the processor has no stream lifecycle;
progressive rendering is handled separately. Copy, insertion and chat saving
continue to consume the original fenced message text.

Row and grid layouts query their own container width: below 32rem they stack
in source order. Grid cells in one line share a height. In a row, boxes share
the width while icons, badges and dividers keep their own size; dividers turn
vertical and arrow icons turn downward when the row stacks. Cards, panels and
callouts mark their contents as boxed, so headings inside them become labels
and metrics drop their own tile border. Callouts use Obsidian's callout markup,
so the theme supplies their colour and icon. Tabs keep the selected tab while
more tabs stream in. The gallery has every primitive, all five golden examples and
rejected-source fallback under `Intelligent UI/Primitives`; verify at 300px and
600px in both Obsidian themes.

## Streaming chat

Chat fence segmentation keeps ordinary Markdown on its existing renderer and
holds one React layout subtree at each fence offset. `UiFence` supplies the
active stream lifecycle: validated completed descendants appear immediately,
unfinished text leaves stay withheld behind placeholder lines, the innermost
open container shows a placeholder where its next content arrives (after a
finished child, only once a new element's opening tag has started), and an open
grid holds its declared columns with placeholder cards. New elements fade in
unless the reader prefers reduced motion. A screen-reader status announces
that the layout is still arriving until the fence closes. Stable child positions retain completed DOM and Markdown
resources across parser snapshots. A stopped or closed incomplete block shows
its complete original body, matching the static code-block processor.
