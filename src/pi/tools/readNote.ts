import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { PiNote, PiToolContext } from "./index";
import { textResult } from "./toolResult";

const READ_NOTE_PARAMS = Type.Object({
  path: Type.String({ description: "Vault-relative path of the note to read." }),
});

/** Reads one note by its vault path, the follow-up to a search hit. */
export const readNoteTool: AgentHarnessTool<PiToolContext, typeof READ_NOTE_PARAMS> = {
  name: "read_note",
  label: "Read note",
  description:
    "Read one note from the vault by its path, e.g. 'Projects/Roadmap.md'. Paths come from search_vault results or from the user.",
  parameters: READ_NOTE_PARAMS,
  execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
    const note: PiNote | null = await context.readNote(params.path);
    if (!note) return textResult(`No note found at "${params.path}".`, { path: params.path });
    return textResult(`# ${note.path}\n\n${note.content}`, { path: note.path });
  },
};
