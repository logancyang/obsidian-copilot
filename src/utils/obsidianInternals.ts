export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readProperty(target: unknown, key: string): unknown {
  return isRecord(target) ? target[key] : undefined;
}

export function callMethod(target: unknown, name: string, ...args: unknown[]): unknown {
  const method = readProperty(target, name);
  return typeof method === "function" ? Reflect.apply(method, target, args) : undefined;
}
