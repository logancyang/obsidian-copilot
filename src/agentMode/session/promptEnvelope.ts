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
 * The envelope closes the prompt, so both tags are searched for from the end.
 * The context blocks in front of it inline whole note excerpts verbatim, so a
 * note that merely mentions `<user-message>` would otherwise be mistaken for
 * the wrapper and restore the user's bubble as the tail of that context. The
 * closing tag is taken last for the same reason, and because a prompt can be
 * stored with something after the envelope — the Claude adapter appends a note
 * in place of an image it cannot send, and the transcript hands both blocks
 * over as one string.
 *
 * The tags are not escaped, so this cannot be exact: a user who types
 * `<user-message>` into the composer loses everything before it. That is a
 * deliberate prompt, where an excerpt is any note the user attached, so the
 * larger surface wins.
 *
 * @param content - Stored prompt text, wrapped or not.
 * @returns What the user typed, or `content` unchanged when there is no wrapper
 *   (prompts sent without attached context are not wrapped).
 */
export function stripUserMessageWrapper(content: string): string {
  const end = content.lastIndexOf(CLOSE_TAG);
  const start = end === -1 ? -1 : content.lastIndexOf(OPEN_TAG, end);
  if (start === -1 || end <= start) return content;
  // The envelope puts the prompt on its own lines; those two are the wrapper's,
  // not the user's.
  return content
    .slice(start + OPEN_TAG.length, end)
    .replace(/^\n/, "")
    .replace(/\n$/, "");
}
