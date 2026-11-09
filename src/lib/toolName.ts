export function humanizeToolName(name: string): string {
  const words = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

// Services such as Notion prefix every tool name with their own name, which the label already gives beside it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/878
export function serviceToolName(serviceName: string, toolName: string): string {
  const words = humanizeToolName(toolName);
  const prefix = `${serviceName.toLowerCase()} `;
  return words.toLowerCase().startsWith(prefix)
    ? humanizeToolName(words.slice(prefix.length))
    : words;
}
