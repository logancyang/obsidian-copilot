interface CustomConnectorIdentity {
  readonly id: string;
  readonly name: string;
}

export interface LocalConnectorConfig extends CustomConnectorIdentity {
  readonly command: string;
  readonly args: readonly string[];
  readonly envNames: readonly string[];
}

export interface RemoteConnectorConfig extends CustomConnectorIdentity {
  readonly url: string;
  readonly headerNames: readonly string[];
}

export type CustomConnectorConfig = LocalConnectorConfig | RemoteConnectorConfig;

export interface ParsedCustomConnector {
  readonly config: CustomConnectorConfig;
  readonly secrets: Readonly<Record<string, string>>;
}

export type CustomConnectorParse =
  | { readonly ok: true; readonly connectors: readonly ParsedCustomConnector[] }
  | { readonly ok: false; readonly error: string };

const MAX_ID_LENGTH = 16;
const ID_PATTERN = /^[a-z0-9]{1,16}$/;
const UNKNOWN_SHAPE = 'Paste an "mcpServers" block, or one server with "command" or "url".';

class ConfigError extends Error {}

export function parseCustomConnectors(
  text: string,
  takenIds: ReadonlySet<string>
): CustomConnectorParse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "This isn't valid JSON." };
  }
  try {
    const taken = new Set(takenIds);
    const connectors = namedServers(json).map(([name, server]) => {
      const id = freeId(name, taken);
      taken.add(id);
      return readServer(id, name, server);
    });
    return { ok: true, connectors };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { ok: false, error: error.message };
  }
}

export function isCustomConnectorConfig(value: unknown): value is CustomConnectorConfig {
  if (!isRecord(value) || typeof value.id !== "string" || !ID_PATTERN.test(value.id)) return false;
  if (typeof value.name !== "string") return false;
  // Every reader tells a local connector by its "command" key, so a remote entry that still has one would be read as local and crash startup.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
  return typeof value.command === "string"
    ? isStringList(value.args) && isStringList(value.envNames)
    : !("command" in value) && typeof value.url === "string" && isStringList(value.headerNames);
}

export function secretNames(config: CustomConnectorConfig): readonly string[] {
  return "command" in config ? config.envNames : config.headerNames;
}

export function requireOneServer(parsed: CustomConnectorParse): CustomConnectorParse {
  return parsed.ok && parsed.connectors.length !== 1
    ? { ok: false, error: "Paste one server to edit this connector." }
    : parsed;
}

export function editableConfigText(
  config: CustomConnectorConfig,
  values: Readonly<Record<string, string>> = {}
): string {
  const fill = (names: readonly string[]) =>
    Object.fromEntries(names.map((name) => [name, values[name] ?? ""]));
  const server =
    "command" in config
      ? { command: config.command, args: config.args, env: fill(config.envNames) }
      : { url: config.url, headers: fill(config.headerNames) };
  return JSON.stringify({ mcpServers: { [config.name]: server } }, null, 2);
}

function namedServers(json: unknown): [string, unknown][] {
  if (!isRecord(json)) throw new ConfigError(UNKNOWN_SHAPE);
  if (isRecord(json.mcpServers)) {
    const servers = Object.entries(json.mcpServers);
    if (servers.length === 0) throw new ConfigError('The "mcpServers" block has no servers.');
    return servers;
  }
  if (!("command" in json) && !("url" in json)) throw new ConfigError(UNKNOWN_SHAPE);
  if (typeof json.name !== "string" || !json.name.trim()) {
    throw new ConfigError('Add a "name" to the server, or paste it inside an "mcpServers" block.');
  }
  return [[json.name.trim(), json]];
}

function readServer(id: string, name: string, server: unknown): ParsedCustomConnector {
  if (!isRecord(server)) throw new ConfigError(`"${name}" needs a "command" or a "url".`);
  const { command, url } = server;
  if (command !== undefined && url !== undefined) {
    throw new ConfigError(`"${name}" has both a "command" and a "url". Keep one.`);
  }
  if (typeof command === "string" && command.trim()) {
    const args = server.args ?? [];
    if (!isStringList(args)) {
      throw new ConfigError(`"${name}": "args" must be a list of text values.`);
    }
    const env = readValues(name, "env", server.env);
    return {
      config: { id, name, command: command.trim(), args, envNames: Object.keys(env) },
      secrets: env,
    };
  }
  if (typeof url === "string" && url.trim()) {
    if (!/^https?:\/\//i.test(url.trim())) {
      throw new ConfigError(`"${name}": "url" must start with http:// or https://.`);
    }
    const headers = readValues(name, "headers", server.headers);
    return {
      config: { id, name, url: url.trim(), headerNames: Object.keys(headers) },
      secrets: headers,
    };
  }
  throw new ConfigError(`"${name}" needs a "command" or a "url".`);
}

function readValues(name: string, field: string, value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
    throw new ConfigError(`"${name}": "${field}" values must be text.`);
  }
  return value as Record<string, string>;
}

function freeId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, MAX_ID_LENGTH) || "custom";
  let id = base;
  for (let n = 2; taken.has(id); n++) {
    id = `${base.slice(0, MAX_ID_LENGTH - String(n).length)}${n}`;
  }
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
