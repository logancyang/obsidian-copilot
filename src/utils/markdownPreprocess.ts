function normalizeLatexDelimiters(content: string): string {
  const parts = content.split(/(```[\s\S]*?```|`[^`]*`)/g);

  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;

      return part
        .replace(/\\\[\s*/g, "$$")
        .replace(/\s*\\\]/g, "$$")
        .replace(/\\\(\s*/g, "$")
        .replace(/\s*\\\)/g, "$");
    })
    .join("");
}

function escapeDataviewCodeBlocks(text: string): string {
  text = text.replace(/```dataview(\s*(?:\n|$))/g, "```text$1");
  text = text.replace(/```dataviewjs(\s*(?:\n|$))/g, "```javascript$1");
  return text;
}

function escapeTasksCodeBlocks(text: string): string {
  return text.replace(/```tasks(\s*(?:\n|$))/g, "```text$1");
}

export function preprocessAIResponse(content: string): string {
  const dataviewEscaped = escapeDataviewCodeBlocks(content);
  const tasksEscaped = escapeTasksCodeBlocks(dataviewEscaped);
  return normalizeLatexDelimiters(tasksEscaped);
}
