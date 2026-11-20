import architectureModule from "./scripts/architecture.js";

const { importRows, loadArchitecture, noNodeInPortableCode } = architectureModule;
const { graph, debt } = loadArchitecture(import.meta.dirname);

const BACKEND_LAYERS = [
  { type: "registry", pattern: "src/agentMode/backends/registry.ts" },
  { type: "acp", pattern: "src/agentMode/acp/**" },
  { type: "sdk", pattern: "src/agentMode/sdk/**" },
  { type: "backend", pattern: "src/agentMode/backends/*/**", capture: ["name"] },
];

const elements = graph.boxes.flatMap(({ box, files }) =>
  box === "backends"
    ? BACKEND_LAYERS.map((layer) => ({ ...layer, category: box, mode: "full" }))
    : [{ type: box, category: box, pattern: files, mode: "full" }]
);

const rows = importRows(graph);
const backendsRow = rows.find(({ box }) => box === "backends");

const boxRules = rows
  .filter(({ box }) => box !== "backends")
  .flatMap(({ box, value, typeOnly }) => [
    { from: { category: box }, allow: { to: { category: [box, ...value] } } },
    ...(typeOnly.length > 0
      ? [
          {
            from: { category: box },
            allow: { to: { category: typeOnly }, dependency: { kind: "type" } },
          },
        ]
      : []),
  ]);

const belowBackends = { category: backendsRow.value };

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

const gatedRules = graph.gated.map(([from, to]) => ({
  from: { category: from },
  allow: {
    to: { category: to },
    dependency: [{ nodeKind: "dynamic-import" }, { kind: "type" }],
  },
}));

const debtRules = Object.entries(debt.imports).map(([file, sources]) => ({
  from: { path: file },
  allow: { dependency: { source: sources } },
}));

const nodeAccessRule = "copilot/no-node-in-portable-code";

const nodeAccessConfigs = [
  ...[...graph.boxes].reverse().map(({ files, desktop }) => ({
    files,
    rules: { [nodeAccessRule]: desktop ? "off" : "error" },
  })),
  {
    files: ["**/*.test.{ts,tsx}", "**/__mocks__/**", ...debt.nodeAccess],
    rules: { [nodeAccessRule]: "off" },
  },
];

export const architecture = {
  elements,
  rules: [...boxRules, ...backendRules, ...gatedRules, ...debtRules],
  nodeAccessConfigs,
  lintRules: { "no-node-in-portable-code": noNodeInPortableCode },
};
