const OPEN_TAG = "<user-message>";
const CLOSE_TAG = "</user-message>";

export function stripUserMessageWrapper(content: string): string {
  const end = content.lastIndexOf(CLOSE_TAG);
  const start = end === -1 ? -1 : content.lastIndexOf(OPEN_TAG, end);
  if (start === -1 || end <= start) return content;
  return content
    .slice(start + OPEN_TAG.length, end)
    .replace(/^\n/, "")
    .replace(/\n$/, "");
}

// Some agents end the turn when a reply is cut off, mid tool call or mid text, so the plugin hands the cause back once. https://github.com/Brevilabs/obsidian-copilot-private/issues/739
export const OUTPUT_LIMIT_CONTINUATION_PROMPT =
  "Your last reply hit the output limit and was cut off, so any unfinished step did not run. Continue in smaller steps without recapping.";
