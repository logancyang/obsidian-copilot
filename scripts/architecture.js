const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const DESKTOP_PART = "/desktop";
const RESOLVE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  "/index.ts",
  "/index.tsx",
];
const NODE_GLOBALS = new Set(["process", "Buffer", "__dirname", "__filename"]);
const GLOBAL_OBJECTS = new Set(["window", "globalThis", "global", "self", "activeWindow"]);
const TS_WRAPPERS = new Set(["TSAsExpression", "TSNonNullExpression", "TSTypeAssertion"]);

function unwrapExpression(node) {
  return TS_WRAPPERS.has(node.type) ? unwrapExpression(node.expression) : node;
}

function readJson(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
}

function loadArchitecture(root = process.cwd()) {
  return {
    root,
    graph: readJson(root, "architecture.json"),
    debt: readJson(root, "architecture.debt.json"),
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

function desktopBoxes(graph) {
  return new Set(graph.boxes.filter(({ desktop }) => desktop).map(({ box }) => box));
}

function featureOf(box) {
  return box.startsWith("features/") ? box.split("/")[1] : null;
}

function expandBox(graph, name) {
  const features = graph.boxes.map(({ box }) => box).filter((box) => featureOf(box));
  if (name === "features/*") return features.filter((box) => !box.endsWith(DESKTOP_PART));
  if (name === "features/*/desktop") return features.filter((box) => box.endsWith(DESKTOP_PART));
  return [name];
}

function importRows(graph) {
  const names = new Set(graph.boxes.map(({ box }) => box));
  const desktop = desktopBoxes(graph);
  const sameFeatureOrNone = (from, to) =>
    !featureOf(from) || !featureOf(to) || featureOf(from) === featureOf(to);
  return Object.entries(graph.edges).flatMap(([source, targets]) =>
    expandBox(graph, source).map((box) => {
      const reach = targets.flatMap((target) => expandBox(graph, target));
      if (featureOf(box) && box.endsWith(DESKTOP_PART)) {
        reach.push(box.slice(0, -DESKTOP_PART.length));
      }
      const value = reach.filter((to) => names.has(to) && sameFeatureOrNone(box, to));
      const typeOnly = desktop.has(box)
        ? []
        : [box, ...value]
            .map((to) => `${to}${DESKTOP_PART}`)
            .filter((to) => names.has(to) && sameFeatureOrNone(box, to));
      return { box, value, typeOnly };
    })
  );
}

function isTypeOnlyImport(statement) {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    const named = clause.namedBindings;
    return (
      !clause.name &&
      named !== undefined &&
      ts.isNamedImports(named) &&
      named.elements.length > 0 &&
      named.elements.every((element) => element.isTypeOnly)
    );
  }
  return statement.isTypeOnly === true;
}

function staticValueImports(fileName, text) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false);
  return source.statements
    .filter(
      (statement) =>
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier !== undefined &&
        !isTypeOnlyImport(statement)
    )
    .map((statement) => statement.moduleSpecifier.text);
}

function resolveImport(root, importer, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith("."))
    base = path.posix.join(path.posix.dirname(importer), specifier);
  else return null;
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    const absolute = path.join(root, candidate);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return candidate;
  }
  return null;
}

function mobileLoadClosure(root = process.cwd(), entry = "src/main.ts") {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file) || !/\.(ts|tsx)$/.test(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const specifier of staticValueImports(file, text)) {
      const target = resolveImport(root, file, specifier);
      if (target) pending.push(target);
    }
  }
  return [...seen].sort();
}

function isBuildTimeNodeEnv(identifier) {
  const env = identifier.parent;
  const nodeEnv = env?.parent;
  return (
    identifier.name === "process" &&
    env?.type === "MemberExpression" &&
    env.object === identifier &&
    env.property.name === "env" &&
    nodeEnv?.type === "MemberExpression" &&
    nodeEnv.object === env &&
    nodeEnv.property.name === "NODE_ENV"
  );
}

const noNodeInPortableCode = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      nodeAccess:
        "{{access}} reaches Node or Electron, which do not exist on a phone. This file is portable code in architecture.json. Move the code into a desktop folder and reach it through the app's gated desktop entry.",
    },
  },
  create(context) {
    const report = (node, access) =>
      context.report({ node, messageId: "nodeAccess", data: { access } });
    const reportElectronSource = (node) => {
      const typeOnly = node.importKind === "type" || node.exportKind === "type";
      if (node.source?.value === "electron" && !typeOnly) report(node, 'import "electron"');
    };
    return {
      ImportDeclaration: reportElectronSource,
      ExportNamedDeclaration: reportElectronSource,
      ExportAllDeclaration: reportElectronSource,
      ImportSpecifier(node) {
        const typeOnly = node.importKind === "type" || node.parent.importKind === "type";
        if (node.imported.name === "requireNodeModule" && !typeOnly) {
          report(node, "requireNodeModule");
        }
      },
      MemberExpression(node) {
        const name = node.computed ? node.property.value : node.property.name;
        const object = unwrapExpression(node.object);
        if (name === "require" || name === "requireNodeModule") {
          report(node, `.${name}`);
        } else if (
          NODE_GLOBALS.has(name) &&
          object.type === "Identifier" &&
          GLOBAL_OBJECTS.has(object.name)
        ) {
          report(node, `${object.name}.${name}`);
        }
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && node.source.value === "electron") {
          report(node, 'import("electron")');
        }
      },
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type === "Identifier" &&
          callee.name === "require" &&
          node.arguments[0]?.type === "Literal" &&
          node.arguments[0].value === "electron"
        ) {
          report(node, 'require("electron")');
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
          if (reference.isTypeReference || isBuildTimeNodeEnv(identifier)) continue;
          reported.add(identifier);
          report(identifier, identifier.name);
        }
      },
    };
  },
};

module.exports = {
  createBoxOf,
  desktopBoxes,
  globToRegExp,
  importRows,
  loadArchitecture,
  mobileLoadClosure,
  noNodeInPortableCode,
  resolveImport,
  staticValueImports,
};
