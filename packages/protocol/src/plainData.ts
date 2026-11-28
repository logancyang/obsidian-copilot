export interface NonPlainField {
  path: string;
  found: string;
}

export function findNonPlainField(value: unknown): NonPlainField | null {
  return walk(value, "", new Set());
}

function walk(value: unknown, path: string, ancestors: Set<object>): NonPlainField | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? null : { path, found: String(value) };
  }
  if (typeof value !== "object") return { path, found: typeof value };
  if (ancestors.has(value)) return { path, found: "circular reference" };
  const prototype: unknown = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (prototype !== (isArray ? Array.prototype : Object.prototype) && prototype !== null) {
    return { path, found: value.constructor.name };
  }
  ancestors.add(value);
  const found = isArray ? walkItems(value, path, ancestors) : walkFields(value, path, ancestors);
  ancestors.delete(value);
  return found;
}

function walkItems(items: unknown[], path: string, ancestors: Set<object>): NonPlainField | null {
  for (let i = 0; i < items.length; i++) {
    const found = walk(items[i], `${path}[${i}]`, ancestors);
    if (found) return found;
  }
  return null;
}

function walkFields(fields: object, path: string, ancestors: Set<object>): NonPlainField | null {
  for (const [key, field] of Object.entries(fields)) {
    // An optional field holding undefined reads the same as a missing one once JSON drops it. https://github.com/Brevilabs/obsidian-copilot-private/issues/1003
    if (field === undefined) continue;
    const found = walk(field, path ? `${path}.${key}` : key, ancestors);
    if (found) return found;
  }
  return null;
}
