const fs = require("fs");
const path = require("path");

const HOST_PART = "/host";

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

function clientBoxes(graph) {
  return new Set(graph.boxes.filter(({ client }) => client).map(({ box }) => box));
}

function featureOf(box) {
  return box.startsWith("features/") ? box.split("/")[1] : null;
}

function expandBox(graph, name) {
  const features = graph.boxes.map(({ box }) => box).filter((box) => featureOf(box));
  if (name === "features/*") return features.filter((box) => !box.endsWith(HOST_PART));
  if (name === "features/*/host") return features.filter((box) => box.endsWith(HOST_PART));
  return [name];
}

function importRows(graph) {
  const names = new Set(graph.boxes.map(({ box }) => box));
  return Object.entries(graph.edges).flatMap(([source, targets]) =>
    expandBox(graph, source).map((box) => {
      const reach = targets.flatMap((target) => expandBox(graph, target));
      if (featureOf(box) && box.endsWith(HOST_PART)) {
        reach.push(box.slice(0, -HOST_PART.length));
      }
      return { box, allowed: reach.filter((to) => names.has(to)) };
    })
  );
}

module.exports = {
  clientBoxes,
  createBoxOf,
  globToRegExp,
  importRows,
  loadArchitecture,
};
