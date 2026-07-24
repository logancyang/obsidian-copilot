// Lightweight mock for @earendil-works/pi-agent-core so unit tests can import
// modules that reference its runtime values (AgentHarness, Session,
// InMemorySessionStorage, calculateContextTokens) without pulling the real
// ESM-only package through ts-jest. `AgentHarness.instances` exposes the
// constructed harnesses so tests can inspect their options and emit events;
// reset it between tests.

class InMemorySessionStorage {}

class Session {
  constructor(storage) {
    this.storage = storage;
  }
}

class AgentHarness {
  constructor(options) {
    this.options = options;
    this.model = options.model;
    this.listeners = new Set();
    this.prompt = jest.fn(async () => ({ role: "assistant" }));
    this.abort = jest.fn(async () => ({ aborted: true }));
    this.waitForIdle = jest.fn(async () => undefined);
    this.compact = jest.fn(async () => ({}));
    AgentHarness.instances.push(this);
  }

  getModel() {
    return this.model;
  }

  async setModel(model) {
    this.model = model;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test hook: deliver an event to every subscriber. */
  emit(event) {
    for (const listener of this.listeners) listener(event);
  }
}

AgentHarness.instances = [];

function calculateContextTokens(usage) {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

class FileError extends Error {
  constructor(code, message, path) {
    super(message);
    this.code = code;
    this.path = path;
  }
}

/**
 * JSONL session storage, faithful enough to exercise our filesystem shim:
 * `create` writes a header through it and `open` reads the file back, so a
 * missing transcript surfaces the same way the real one does.
 */
class JsonlSessionStorage {
  constructor(fs, filePath, entries) {
    this.fs = fs;
    this.filePath = filePath;
    this.entries = entries;
  }

  static async create(fs, filePath, options) {
    const result = await fs.writeFile(
      filePath,
      JSON.stringify({ type: "header", ...options }) + "\n"
    );
    if (!result.ok) throw result.error;
    return new JsonlSessionStorage(fs, filePath, []);
  }

  static async open(fs, filePath) {
    const result = await fs.readTextLines(filePath);
    if (!result.ok) throw result.error;
    return new JsonlSessionStorage(fs, filePath, result.value.filter(Boolean));
  }

  async getEntries() {
    return this.entries;
  }
}

module.exports = {
  AgentHarness,
  FileError,
  InMemorySessionStorage,
  JsonlSessionStorage,
  Session,
  calculateContextTokens,
};
