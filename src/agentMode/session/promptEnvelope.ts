const OPEN_TAG = "<user-message>";
const CLOSE_TAG = "</user-message>";

/**
 * Unwrap the `<user-message>…</user-message>` envelope a prompt is wrapped in
 * when the plugin prepends context blocks to it.
 *
 * A prompt that carries attached notes, project context, or web excerpts is sent
 * to the agent as `<context blocks>\n\n<user-message>what the user typed
 * </user-message>` — the wrapper exists so the model can tell the two apart. The
 * user never sees it live, because the visible message is created from the typed
 * text before the envelope is built. Any path that rebuilds the conversation from
 * what the *agent* stored gets the wrapped form instead, and has to undo it or
 * the restored bubble shows the whole context block as if the user had typed it.
 *
 * The wrapper is delimited by its *last* closing tag, not its first. Taking the
 * first would silently cut the rest of a prompt that types `</user-message>`
 * into the composer, and requiring the tag to end the text would miss a stored
 * prompt that has anything after the envelope — the Claude adapter appends a
 * note in place of an image it cannot send, and the transcript hands both
 * blocks over as one string.
 *
 * @param content - Stored prompt text, wrapped or not.
 * @returns What the user typed, or `content` unchanged when there is no wrapper
 *   (prompts sent without attached context are not wrapped).
 */
export function stripUserMessageWrapper(content: string): string {
  const start = content.indexOf(OPEN_TAG);
  const end = content.lastIndexOf(CLOSE_TAG);
  if (start === -1 || end <= start) return content;
  // The envelope puts the prompt on its own lines; those two are the wrapper's,
  // not the user's.
  return content
    .slice(start + OPEN_TAG.length, end)
    .replace(/^\n/, "")
    .replace(/\n$/, "");
}
