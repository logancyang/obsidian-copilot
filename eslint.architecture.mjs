import architectureModule from "./scripts/architecture.js";

const { clientBoxes, importRows, loadArchitecture, noHostAccessInClient } = architectureModule;
const { graph, debt } = loadArchitecture(import.meta.dirname);

const BACKEND_LAYERS = [
  { type: "registry", pattern: "apps/obsidian/src/agentMode/backends/registry.ts" },
  { type: "acp", pattern: "apps/obsidian/src/agentMode/acp/**" },
  { type: "sdk", pattern: "apps/obsidian/src/agentMode/sdk/**" },
  { type: "backend", pattern: "apps/obsidian/src/agentMode/backends/*/**", capture: ["name"] },
];

const elements = graph.boxes.flatMap(({ box, files }) =>
  box === "host/backends"
    ? BACKEND_LAYERS.map((layer) => ({ ...layer, category: box, mode: "full" }))
    : [{ type: box, category: box, pattern: files, mode: "full" }]
);

const rows = importRows(graph);
const belowBackends = { category: rows.find(({ box }) => box === "host/backends").allowed };

const boxRules = rows
  .filter(({ box }) => box !== "host/backends")
  .map(({ box, allowed }) => ({
    from: { category: box },
    allow: { to: { category: [box, ...allowed] } },
  }));

const backendRules = [
  { from: { type: "acp" }, allow: { to: [{ type: "acp" }, belowBackends] } },
  { from: { type: "sdk" }, allow: { to: [{ type: "sdk" }, belowBackends] } },
  {
    from: { type: "backend" },
    allow: [
      { to: [{ type: ["acp", "sdk"] }, belowBackends] },
      { to: { type: "backend", captured: { name: "{{from.captured.name}}" } } },
      { to: { type: "backend", captured: { name: "shared" } } },
    ],
  },
  { from: { type: "registry" }, allow: { to: [{ type: "backend" }, belowBackends] } },
];

const debtRules = Object.entries(debt.imports).map(([file, sources]) => ({
  from: { path: file },
  allow: { dependency: { source: sources } },
}));

const clientAccessRule = "copilot/no-host-access-in-client";

const runsAnywhere = clientBoxes(graph);

const clientAccessConfigs = [
  ...[...graph.boxes].reverse().map(({ box, files }) => ({
    files,
    rules: { [clientAccessRule]: runsAnywhere.has(box) ? "error" : "off" },
  })),
  {
    files: ["**/*.test.{ts,tsx}", "**/__mocks__/**", ...debt.clientAccess],
    rules: { [clientAccessRule]: "off" },
  },
];

export const architecture = {
  elements,
  rules: [...boxRules, ...backendRules, ...debtRules],
  clientAccessConfigs,
  lintRules: { "no-host-access-in-client": noHostAccessInClient },
  undisableableRules: ["boundaries/*", clientAccessRule],
};
