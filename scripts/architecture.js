const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { isBuiltin } = require("module");

const NODE_GLOBALS = new Set(["process", "Buffer", "__dirname", "__filename", "require", "NodeJS"]);
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "global", "self", "activeWindow"]);
const TS_WRAPPERS = new Set(["TSAsExpression", "TSNonNullExpression", "TSTypeAssertion"]);

function unwrapExpression(node) {
  return TS_WRAPPERS.has(node.type) ? unwrapExpression(node.expression) : node;
}

function isHostModule(source) {
  return source === "obsidian" || source === "electron" || isBuiltin(source);
}

function readJson(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
}

const DEBT_FILE = "architecture.debt.json";

function readDebtAt(ref, root = process.cwd()) {
  const show = ["show", `${ref}:${DEBT_FILE}`];
  return JSON.parse(execFileSync("git", show, { cwd: root, encoding: "utf8", stdio: "pipe" }));
}

// Totals, not entry paths, so moving a file renames its entries without failing: https://github.com/Brevilabs/obsidian-copilot-private/issues/993
function compareDebt(base, head) {
  const before = base.counts;
  const after = head.counts;
  const totals = `imports ${before.imports} -> ${after.imports}, client access ${before.clientAccess} -> ${after.clientAccess}`;
  const ok = after.imports <= before.imports && after.clientAccess <= before.clientAccess;
  return {
    ok,
    message: ok
      ? `${DEBT_FILE} did not grow (${totals}).`
      : `${DEBT_FILE} grew against the base branch (${totals}). The list only shrinks: fix the import instead of listing it.`,
  };
}

function loadArchitecture(root = process.cwd()) {
  return {
    root,
    graph: readJson(root, "architecture.json"),
    debt: readJson(root, DEBT_FILE),
  };
}

function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    if (glob.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 2;
    } else if (glob.startsWith("**", index)) {
      source += ".*";
      index += 1;
    } else if (glob[index] === "*") {
      source += "[^/]*";
    } else if (glob[index] === "{") {
      const end = glob.indexOf("}", index);
      const options = glob.slice(index + 1, end).split(",");
      source += `(?:${options.map(escapeRegExp).join("|")})`;
      index = end;
    } else {
      source += escapeRegExp(glob[index]);
    }
  }
  return new RegExp(`^${source}$`);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createBoxOf(graph) {
  const matchers = graph.boxes.flatMap(({ box, files }) =>
    files.map((glob) => ({ box, pattern: globToRegExp(glob) }))
  );
  return (file) => matchers.find(({ pattern }) => pattern.test(file))?.box ?? null;
}

function clientBoxes(graph) {
  const runsAnywhere = (box) =>
    graph.runsAnywhere.some((name) => (name.endsWith("/") ? box.startsWith(name) : box === name));
  return new Set(graph.boxes.map(({ box }) => box).filter(runsAnywhere));
}

function featureOf(box) {
  return /^(?:client|host)\/features\/([^/]+)$/.exec(box)?.[1] ?? null;
}

function expandBox(graph, name) {
  if (!name.endsWith("/*")) return [name];
  const prefix = name.slice(0, -1);
  return graph.boxes
    .map(({ box }) => box)
    .filter((box) => box.startsWith(prefix) && featureOf(box));
}

function importRows(graph) {
  const names = new Set(graph.boxes.map(({ box }) => box));
  return Object.entries(graph.edges).flatMap(([source, targets]) =>
    expandBox(graph, source).map((box) => {
      const reach = targets.flatMap((target) => expandBox(graph, target));
      if (box.startsWith("host/features/")) reach.push(`client/features/${featureOf(box)}`);
      return { box, allowed: reach.filter((to) => names.has(to)) };
    })
  );
}

function keyName(key, computed) {
  if (key.type === "Literal") return key.value;
  return computed ? undefined : key.name;
}

// The bundler replaces only the static form; process.env[name] stays runtime Node access: https://github.com/Brevilabs/obsidian-copilot-private/issues/993
function isBuildTimeNodeEnv(identifier) {
  const env = identifier.parent;
  const nodeEnv = env?.parent;
  return (
    identifier.name === "process" &&
    env?.type === "MemberExpression" &&
    env.object === identifier &&
    !env.computed &&
    env.property.name === "env" &&
    nodeEnv?.type === "MemberExpression" &&
    nodeEnv.object === env &&
    !nodeEnv.computed &&
    nodeEnv.property.name === "NODE_ENV"
  );
}

const noHostAccessInClient = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      hostAccess:
        "{{access}} reaches Node, Electron or Obsidian, which chat client code cannot use: it must run in any shell. This file is client code in architecture.json. Move the code to the host, or reach it through the session protocol or the shell interface.",
    },
  },
  create(context) {
    const report = (node, access) =>
      context.report({ node, messageId: "hostAccess", data: { access } });
    const reportProperty = (node, name, object) => {
      if (name === "require" || name === "requireNodeModule") {
        report(node, `.${name}`);
      } else if (
        NODE_GLOBALS.has(name) &&
        object.type === "Identifier" &&
        GLOBAL_OBJECTS.has(object.name)
      ) {
        report(node, `${object.name}.${name}`);
      }
    };
    const reportHostSource = (node) => {
      const source = node.source?.value;
      if (typeof source === "string" && isHostModule(source)) report(node, `import "${source}"`);
    };
    return {
      ImportDeclaration: reportHostSource,
      ExportNamedDeclaration: reportHostSource,
      ExportAllDeclaration: reportHostSource,
      ImportExpression(node) {
        const source = node.source.type === "Literal" ? node.source.value : null;
        if (typeof source === "string" && isHostModule(source)) report(node, `import("${source}")`);
      },
      TSImportType(node) {
        if (isHostModule(node.source.value)) report(node, `import("${node.source.value}")`);
      },
      ImportSpecifier(node) {
        if (node.imported.name === "requireNodeModule") report(node, "requireNodeModule");
      },
      MemberExpression(node) {
        reportProperty(node, keyName(node.property, node.computed), unwrapExpression(node.object));
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !node.init) return;
        const object = unwrapExpression(node.init);
        for (const property of node.id.properties) {
          if (property.type === "Property") {
            reportProperty(property, keyName(property.key, property.computed), object);
          }
        }
      },
      "Program:exit"() {
        const globalScope = context.sourceCode.scopeManager.globalScope;
        const references = [
          ...globalScope.through,
          ...[...NODE_GLOBALS].flatMap((name) => globalScope.set.get(name)?.references ?? []),
        ];
        const reported = new Set();
        for (const reference of references) {
          const { identifier } = reference;
          if (!NODE_GLOBALS.has(identifier.name) || reported.has(identifier)) continue;
          if (isBuildTimeNodeEnv(identifier)) continue;
          reported.add(identifier);
          report(identifier, identifier.name);
        }
      },
    };
  },
};

module.exports = {
  clientBoxes,
  compareDebt,
  createBoxOf,
  globToRegExp,
  importRows,
  loadArchitecture,
  noHostAccessInClient,
  readDebtAt,
};

if (require.main === module) {
  const head = readJson(process.cwd(), DEBT_FILE);
  const { ok, message } = compareDebt(readDebtAt(process.argv[2] ?? "origin/master"), head);
  (ok ? process.stdout : process.stderr).write(`${message}\n`);
  if (!ok) process.exitCode = 1;
}
