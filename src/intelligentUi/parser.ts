export const UI_LIMITS = Object.freeze({ depth: 12, nodes: 256, text: 32768, source: 65536 });
export const SUPPORTED_ICONS = Object.freeze([
  "arrow-right",
  "check",
  "circle",
  "cloud",
  "code",
  "database",
  "file-text",
  "folder",
  "git-branch",
  "hard-drive",
  "layers",
  "info",
  "lightbulb",
  "link",
  "list",
  "search",
  "settings",
  "shield",
  "sparkles",
  "star",
  "target",
  "zap",
] as const);

type PropRule = "string" | "columns" | "icon";
interface PrimitiveSchema {
  readonly props: Readonly<Record<string, PropRule>>;
  readonly required: readonly string[];
  readonly parents: "containers" | readonly string[];
  readonly children: "elements" | "text" | "none" | "steps" | "content";
}
const CONTAINER = Object.freeze({
  props: Object.freeze({}),
  required: Object.freeze([]),
  parents: "containers",
  children: "elements",
} as const);
const TEXT = Object.freeze({ ...CONTAINER, children: "text" } as const);

export const UI_SCHEMA = Object.freeze({
  stack: CONTAINER,
  row: CONTAINER,
  grid: Object.freeze({
    ...CONTAINER,
    props: Object.freeze({ columns: "columns" }),
    required: Object.freeze(["columns"]),
  }),
  card: Object.freeze({ ...CONTAINER, props: Object.freeze({ title: "string", icon: "icon" }) }),
  panel: CONTAINER,
  divider: Object.freeze({ ...CONTAINER, children: "none" }),
  heading: TEXT,
  text: TEXT,
  badge: TEXT,
  icon: Object.freeze({
    ...CONTAINER,
    props: Object.freeze({ name: "icon" }),
    required: Object.freeze(["name"]),
    children: "none",
  }),
  steps: Object.freeze({ ...CONTAINER, children: "steps" }),
  step: Object.freeze({
    ...CONTAINER,
    props: Object.freeze({ title: "string", icon: "icon" }),
    parents: Object.freeze(["steps"]),
    children: "content",
  }),
  metric: Object.freeze({
    ...CONTAINER,
    props: Object.freeze({ value: "string", label: "string", delta: "string" }),
    required: Object.freeze(["value", "label"]),
    children: "none",
  }),
  markdown: TEXT,
} satisfies Record<string, PrimitiveSchema>);

export type UiTag = keyof typeof UI_SCHEMA;
export interface UiNode {
  readonly tag: UiTag;
  readonly props: Readonly<Record<string, string | number>>;
  readonly children: readonly UiNode[];
  readonly text: string;
  readonly complete: boolean;
}
export type UiErrorCode =
  | "syntax"
  | "unknown-tag"
  | "unknown-prop"
  | "invalid-prop"
  | "missing-prop"
  | "duplicate-prop"
  | "invalid-parent"
  | "invalid-child"
  | "forbidden-text"
  | "mismatched-close"
  | "depth-limit"
  | "node-limit"
  | "text-limit"
  | "source-limit";
export interface UiParseError {
  readonly code: UiErrorCode;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}
export type UiParseResult =
  | Readonly<{ status: "error"; error: UiParseError }>
  | Readonly<{
      status: "complete" | "pending";
      nodes: readonly UiNode[];
      pending: Readonly<{ offset: number }> | null;
    }>;
interface MutableNode {
  tag: UiTag;
  props: Record<string, string | number>;
  children: MutableNode[];
  text: string;
  complete: boolean;
}
const EMPTY_NODES: readonly UiNode[] = Object.freeze([]);
const FORBIDDEN = /[{}]|&(?:#[^;\s<]*|[a-zA-Z][a-zA-Z0-9]*);/;

function freezeNode(node: MutableNode): UiNode {
  return Object.freeze({
    ...node,
    props: Object.freeze(node.props),
    children: node.children.length ? Object.freeze(node.children.map(freezeNode)) : EMPTY_NODES,
  });
}

export function parseIntelligentUi(source: string): UiParseResult {
  const roots: MutableNode[] = [];
  const stack: MutableNode[] = [];
  let offset = 0;
  let count = 0;
  let textSize = 0;
  const error = (code: UiErrorCode, at: number): UiParseResult => {
    const before = source.slice(0, at);
    return Object.freeze({
      status: "error",
      error: Object.freeze({
        code,
        offset: at,
        line: before.split("\n").length,
        column: at - before.lastIndexOf("\n"),
      }),
    });
  };
  const result = (pending: number | null): UiParseResult =>
    Object.freeze({
      status: pending === null ? "complete" : "pending",
      nodes: roots.length ? Object.freeze(roots.map(freezeNode)) : EMPTY_NODES,
      pending: pending === null ? null : Object.freeze({ offset: pending }),
    });
  // Bound unfinished tokens too, since a model can stream an attribute without closing it. https://github.com/Brevilabs/obsidian-copilot-private/issues/880
  if (source.length > UI_LIMITS.source) return error("source-limit", UI_LIMITS.source);
  while (offset < source.length) {
    const start = offset;
    const parent = stack[stack.length - 1];
    if (source[offset] !== "<") {
      const next = source.indexOf("<", offset);
      offset = next < 0 ? source.length : next;
      const text = source.slice(start, offset);
      if (/&(?:#[^;\s<]*|[a-zA-Z][a-zA-Z0-9]*);/.test(text)) return error("forbidden-text", start);
      if (parent && ["text", "content"].includes(UI_SCHEMA[parent.tag].children)) {
        if (parent.children.length && text.trim()) return error("invalid-child", start);
        parent.text += text;
        textSize += text.length;
      } else if (text.trim()) return error("invalid-child", start);
      if (textSize > UI_LIMITS.text) return error("text-limit", start);
      continue;
    }
    let quote = "";
    offset++;
    for (; offset < source.length; offset++) {
      const char = source[offset];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    // Keep completed descendants visible while the next tag or enclosing element is still arriving. https://github.com/Brevilabs/obsidian-copilot-private/issues/880
    if (offset === source.length) return result(start);
    const token = source.slice(start + 1, offset++);
    if (token.startsWith("/")) {
      if (!/^\/[a-z]+$/.test(token)) return error("syntax", start);
      if (!parent || token.slice(1) !== parent.tag) return error("mismatched-close", start);
      parent.complete = true;
      stack.pop();
      continue;
    }
    const match = /^([a-z]+)(?=\s|\/|$)/.exec(token);
    if (!match) return error("syntax", start);
    const tag = match[1];
    if (!Object.hasOwn(UI_SCHEMA, tag)) return error("unknown-tag", start);
    const typedTag = tag as UiTag;
    const schema: PrimitiveSchema = UI_SCHEMA[typedTag];
    // Steps accept prose or structured content without silently changing their order. https://github.com/Brevilabs/obsidian-copilot-private/issues/880
    if (
      parent &&
      (parent.text.trim() ||
        !["elements", "steps", "content"].includes(UI_SCHEMA[parent.tag].children))
    )
      return error("invalid-child", start);
    if (
      schema.parents === "containers"
        ? parent?.tag === "steps"
        : !parent || !schema.parents.includes(parent.tag)
    )
      return error("invalid-parent", start);
    if (stack.length >= UI_LIMITS.depth) return error("depth-limit", start);
    if (++count > UI_LIMITS.nodes) return error("node-limit", start);
    const props: Record<string, string | number> = {};
    let rest = token.slice(tag.length);
    const selfClosing = rest.endsWith("/");
    if (selfClosing) rest = rest.slice(0, -1);
    while (rest.length) {
      if (!rest.trim()) break;
      const attr = /^\s+([a-z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(-?\d+(?:\.\d+)?))/.exec(
        rest
      );
      if (!attr) return error("syntax", start);
      const name = attr[1];
      const value = attr[2] ?? attr[3] ?? attr[4];
      if (!Object.hasOwn(schema.props, name)) return error("unknown-prop", start);
      if (Object.hasOwn(props, name)) return error("duplicate-prop", start);
      if (FORBIDDEN.test(value)) return error("forbidden-text", start);
      const rule = schema.props[name];
      if (rule === "columns") {
        if (!/^[1-3]$/.test(value)) return error("invalid-prop", start);
        props[name] = Number(value);
      } else {
        if (
          attr[4] !== undefined ||
          (rule === "icon" && !(SUPPORTED_ICONS as readonly string[]).includes(value))
        )
          return error("invalid-prop", start);
        props[name] = value;
      }
      textSize += value.length;
      if (textSize > UI_LIMITS.text) return error("text-limit", start);
      rest = rest.slice(attr[0].length);
    }
    if (schema.required.some((name) => !Object.hasOwn(props, name)))
      return error("missing-prop", start);
    const node: MutableNode = {
      tag: typedTag,
      props,
      children: [],
      text: "",
      complete: selfClosing,
    };
    (parent ? parent.children : roots).push(node);
    if (!selfClosing) stack.push(node);
  }
  return result(stack.length ? source.length : null);
}
