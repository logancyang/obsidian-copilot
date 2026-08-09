import { relative } from "node:path";

function escapeData(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeProperty(value) {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

export default function githubActionsFormatter(results) {
  const annotations = [];
  for (const result of results) {
    for (const warning of result.warnings) {
      const level = warning.severity === "error" ? "error" : "warning";
      const file = relative(process.cwd(), result.source);
      annotations.push(
        `::${level} file=${escapeProperty(file)},line=${warning.line ?? 1},col=${warning.column ?? 1},title=${escapeProperty(warning.rule)}::${escapeData(warning.text)}`
      );
    }
  }
  return annotations.join("\n");
}
