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

module.exports = { AgentHarness, InMemorySessionStorage, Session, calculateContextTokens };
