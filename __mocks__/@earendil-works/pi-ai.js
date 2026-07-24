// Lightweight mock for @earendil-works/pi-ai so unit tests can import modules
// that reference its runtime values (createModels, createProvider) without
// pulling the real ESM-only package (and its ESM-only `typebox` dependency)
// through ts-jest. Provider/collection bookkeeping mirrors the real package so
// tests exercise our wiring; stream behavior is out of scope.

function createProvider(input) {
  let dynamicModels = [];
  const currentModels = () => {
    const merged = [...input.models];
    for (const model of dynamicModels) {
      const index = merged.findIndex((entry) => entry.id === model.id);
      if (index >= 0) merged[index] = model;
      else merged.push(model);
    }
    return merged;
  };
  return {
    id: input.id,
    name: input.name ?? input.id,
    baseUrl: input.baseUrl,
    auth: input.auth,
    api: input.api,
    getModels: currentModels,
    refreshModels: input.fetchModels
      ? async (context) => {
          dynamicModels = [...(await input.fetchModels(context))];
        }
      : undefined,
  };
}

function createModels() {
  const providers = new Map();
  const collection = {
    setProvider: (provider) => providers.set(provider.id, provider),
    deleteProvider: (id) => providers.delete(id),
    clearProviders: () => providers.clear(),
    getProviders: () => Array.from(providers.values()),
    getProvider: (id) => providers.get(id),
    getModels: (providerId) => {
      const selected =
        providerId === undefined
          ? Array.from(providers.values())
          : [providers.get(providerId)].filter(Boolean);
      return selected.flatMap((provider) => provider.getModels());
    },
    getModel: (providerId, id) => collection.getModels(providerId).find((model) => model.id === id),
    refresh: async () => {
      for (const provider of providers.values()) {
        if (provider.refreshModels) await provider.refreshModels({ allowNetwork: true });
      }
      return { aborted: false, errors: new Map() };
    },
    getAuth: async (providerId) => {
      const provider = providers.get(providerId);
      return provider?.auth?.apiKey?.resolve({});
    },
  };
  return collection;
}

// `Type` is typebox, re-exported by pi-ai. typebox is ESM-only too, so the
// mock supplies the two constructors our tool schemas use. The shapes are
// JSON Schema, which is exactly what the real builders emit — enough for the
// schema to be asserted on, and `tsc` still checks calls against real typebox.
const Type = {
  Object: (properties = {}, options = {}) => ({
    type: "object",
    properties,
    required: Object.keys(properties),
    ...options,
  }),
  String: (options = {}) => ({ type: "string", ...options }),
};

module.exports = { createModels, createProvider, Type };
