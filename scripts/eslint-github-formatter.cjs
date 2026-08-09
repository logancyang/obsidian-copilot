const path = require("node:path");

function escapeData(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeProperty(value) {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

module.exports = function githubActionsFormatter(results) {
  const annotations = [];
  for (const result of results) {
    for (const message of result.messages) {
      const level = message.severity === 2 ? "error" : "warning";
      const file = path.relative(process.cwd(), result.filePath);
      const rule = message.ruleId ?? "ESLint";
      annotations.push(
        `::${level} file=${escapeProperty(file)},line=${message.line ?? 1},col=${message.column ?? 1},title=${escapeProperty(rule)}::${escapeData(message.message)}`
      );
    }
  }
  return annotations.join("\n");
};
