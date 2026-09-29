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
