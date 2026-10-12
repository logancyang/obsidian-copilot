export function escapeYamlString(str: string): string {
  return (
    str
      // eslint-disable-next-line no-control-regex -- YAML scalar validation must reject embedded control bytes
      .replace(/[\x00-\x1F\x7F]/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
  );
}

export function unescapeYamlString(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "\\" && i + 1 < str.length) {
      const next = str[i + 1];
      if (next === "\\" || next === '"') {
        out += next;
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

export function coerceProjectId(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

export type FrontmatterUpdates = ReadonlyArray<
  readonly [key: string, entry: string | null | undefined]
>;

const FRONTMATTER_BLOCK = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const TOP_LEVEL_KEY = /^([^\s#-][^:]*):(?:\s|$)/;

export function mergeFrontmatter(current: string, updates: FrontmatterUpdates): string {
  const entries = new Map<string, string>();
  let key = "";
  for (const line of current.match(FRONTMATTER_BLOCK)?.[1].split(/\r?\n/) ?? []) {
    key = line.match(TOP_LEVEL_KEY)?.[1] ?? key;
    const previous = entries.get(key);
    entries.set(key, previous === undefined ? line : `${previous}\n${line}`);
  }
  for (const [name, entry] of updates) {
    if (entry === null) entries.delete(name);
    else if (entry !== undefined) entries.set(name, entry);
  }
  return ["---", ...entries.values(), "---"].join("\n");
}
