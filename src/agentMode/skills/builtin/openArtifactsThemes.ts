/**
 * Bundled report themes for the `openartifacts-publish` skill. Each theme is a design
 * brief an agent applies when it renders a note into a page; a user theme with the same
 * shape can live under `.openartifacts/themes/` in the vault and takes precedence.
 */
export const OPENARTIFACTS_DEFAULT_THEME = "research-memo";

export const RESEARCH_MEMO_THEME = `# Research memo

Use for dense analyst-style reports: pricing comparisons, technical evaluations,
research write-ups. Read top to bottom, scanned for numbers. The identity is
"research memo, set properly": serif for everything you read, monospace for
everything you compare, one petrol-teal accent that never competes with the
semantic colors. No third typeface. No pure mid-grey. No em dashes in copy.

## Tokens

Define every color on bare \`:root\`, redefine only tokens in the two dark blocks,
reference tokens from components and never literals, and give \`body\` an explicit
token background. Dark is not an inversion: the accent lightens and the semantic
trio desaturates.

\`\`\`css
:root {
  --ground: #f2f4f4; --paper: #fbfcfc;
  --ink: #141d21; --ink-soft: #47585e; --ink-faint: #7a8b91;
  --rule: #d3dcdd; --rule-soft: #e4eaea;
  --accent: #0d5f66; --accent-soft: #e0eded;
  --warn: #8a5407; --warn-soft: #f6ecd9;
  --stop: #97231d; --stop-soft: #f7e4e2;
  --go: #17603e; --go-soft: #e0efe6;
  --serif: "Iowan Old Style", "Charter", "Palatino Linotype", Palatino, Georgia, ui-serif, serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace;
  --measure: 68ch; --pad: clamp(1.15rem, 4vw, 2.75rem);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0e1518; --paper: #141d21;
    --ink: #e4ecec; --ink-soft: #a3b5b8; --ink-faint: #6e8287;
    --rule: #27363a; --rule-soft: #1d2a2e;
    --accent: #5fbfc2; --accent-soft: #14302f;
    --warn: #e0ac5c; --warn-soft: #2d2415;
    --stop: #e8877f; --stop-soft: #33201e;
    --go: #6cc394; --go-soft: #14291f;
  }
}
:root[data-theme="dark"] { /* repeat the dark tokens above verbatim */ }
body { background: var(--ground); color: var(--ink); font-family: var(--serif); margin: 0; }
\`\`\`

System font stacks only: a linked webfont fails silently to a default. Avoid
Inter and Space Grotesk.

## Type

Serif carries prose and headings. Mono carries every label, table, number,
caption, chip, and stat. Uppercase labels always take positive letter-spacing;
display sizes take tight negative tracking.

| Role | Size | Notes |
| --- | --- | --- |
| h1 | \`clamp(2.1rem, 1.35rem + 3.5vw, 3.6rem)\` | line-height 1.03, tracking -0.022em, weight 600 |
| h2 | \`clamp(1.45rem, 1.2rem + 1.1vw, 1.95rem)\` | line-height 1.15, tracking -0.014em |
| h3 | \`1.12rem\` | weight 600 |
| Standfirst | \`clamp(1.08rem, 1rem + 0.4vw, 1.28rem)\` | line-height 1.5, \`--ink-soft\` |
| Body | \`clamp(1rem, 0.97rem + 0.16vw, 1.075rem)\` | line-height 1.62 |
| Eyebrow | mono \`0.685rem\` | tracking 0.15em, uppercase |
| Table body | mono \`0.795rem\` | \`tabular-nums\` |
| Table head | mono \`0.665rem\` | tracking 0.07em, uppercase, weight 500 |
| Stat numeral | mono \`1.85rem\` | tracking -0.03em, line-height 1 |

Headings get \`text-wrap: balance\`, paragraphs \`text-wrap: pretty\`. Cap prose at
\`max-width: var(--measure)\`; never cap tables or charts.

## Layout

One centered column, \`max-width: 60rem\`, \`padding: 0 var(--pad) 6rem\`. The
wrapper is \`display: flex; flex-direction: column; gap: 3.25rem\`; each section
is a flex column with \`gap: 1.15rem\`. Spacing comes from \`gap\`, never per-element
margins. Wide content sits in a \`.scroller\` with \`overflow-x: auto\` so the body
never scrolls sideways.

## Components

- **Masthead**: mono kicker with dot-separated metadata, h1, standfirst, closed by a \`2px solid var(--ink)\` rule. The only full-weight ink line on the page.
- **Section header**: mono eyebrow naming the kind of content, \`1px\` bottom rule, then h2. No \`01 / 02\` markers unless the content is sequential.
- **Verdict panel**: \`--paper\` background, \`1px\` border, \`4px\` left border in a semantic color, mono uppercase label above the prose. Reserved for findings that change the decision.
- **Duo cards**: \`grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr))\`; mono accent title, optional stat numeral, body copy.
- **Data table**: inside \`.scroller\`; first column left, the rest right-aligned; sticky \`thead\` on \`--paper\`; row hover tints \`--rule-soft\`; group rows use \`--rule-soft\` with uppercase mono labels; cell classes \`.win\`, \`.lose\`, \`.flag\`.
- **Bar chart**: three-column grid per row (label, track, value); fill width from an inline \`--pct\`, \`max-width: 100%\`; \`.over\` swaps the fill to \`--stop\`. Full width equals the reference line.
- **Chips**: mono uppercase \`0.66rem\`, four semantic variants on the \`-soft\` backgrounds.
- **Steps**: mono accent-chip marker plus prose, only where order is real.
- **Details/summary**: for true but secondary material such as corrections and methodology.

## Always

\`font-variant-numeric: tabular-nums\` on columnar numerals; a visible
\`:focus-visible\` outline in the accent with \`outline-offset: 3px\`; a
\`prefers-reduced-motion\` block that removes animation and transition; one
selector per spacing rule so type and element selectors never fight.
`;
