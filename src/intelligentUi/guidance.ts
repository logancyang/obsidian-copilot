import {
  PrimitiveSchema,
  SUPPORTED_ICONS,
  UI_LIMITS,
  UI_SCHEMA,
  UiTag,
} from "@/intelligentUi/parser";

const SCHEMA: Readonly<Record<UiTag, PrimitiveSchema>> = UI_SCHEMA;
const TAGS = Object.keys(SCHEMA) as UiTag[];

function describeProps(schema: PrimitiveSchema): string {
  return Object.entries(schema.props)
    .map(([name, rule]) => {
      const value = Array.isArray(rule)
        ? rule.join("|")
        : rule === "columns"
          ? "1|2|3"
          : rule === "icon"
            ? "icon name"
            : "…";
      return ` ${name}="${value}"${schema.required.includes(name) ? " (required)" : ""}`;
    })
    .join("");
}

function describeNesting(tag: UiTag, schema: PrimitiveSchema): string {
  const parents =
    schema.parents === "containers" ? "" : `only inside ${schema.parents.join(", ")}; `;
  const items = TAGS.filter((child) => {
    const { parents } = SCHEMA[child];
    return parents !== "containers" && parents.includes(tag);
  }).join(", ");
  const content = {
    elements: "contains elements",
    text: "plain text only",
    none: "self-closing",
    items: `contains only ${items}`,
    content: "contains plain text or elements, never both",
  }[schema.children];
  return parents + content;
}

const ELEMENTS = TAGS.map((tag) => {
  const schema = SCHEMA[tag];
  return `- ${tag}${describeProps(schema)} (${describeNesting(tag, schema)}): ${schema.description}`;
}).join("\n");

export const INTELLIGENT_UI_GUIDANCE = `Intelligent UI: use fenced copilot-ui blocks when a visual grouping makes an answer easier to understand, such as side-by-side comparisons, step flows or metric tiles. Keep simple answers in prose; use Markdown tables when clearest and Mermaid for semantic diagrams. Use only one or two layout blocks in a typical answer, with ordinary Markdown around them as needed.
Inside the fence, use this XML-like grammar, not HTML or JSX. These are the only elements and attributes; attributes are optional unless marked required:
${ELEMENTS}
Quote attribute values (columns may also be an unquoted integer). Close every tag and self-close elements that have no content. Do not use HTML, expressions, entities or literal < in text. Supported icon names: ${SUPPORTED_ICONS.join(", ")}. Stay within ${UI_LIMITS.depth} nesting levels, ${UI_LIMITS.nodes} elements, ${UI_LIMITS.text} text units and ${UI_LIMITS.source} source units per block.
Example:
\`\`\`copilot-ui
<grid columns="2"><card title="Option A"><text>Easy to start.</text></card><card title="Option B"><text>More flexible.</text></card></grid>
\`\`\``;
