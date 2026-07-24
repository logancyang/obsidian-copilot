import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { PiToolContext } from "./index";
import { textResult } from "./toolResult";

const SEARCH_VAULT_PARAMS = Type.Object({
  query: Type.String({ description: "What to look for, in natural language or keywords." }),
});

/**
 * Finds notes by meaning or keyword. Returns paths plus excerpts rather than
 * whole notes, so the model can pick what is worth reading in full instead of
 * paying for every candidate.
 */
export const searchVaultTool: AgentHarnessTool<PiToolContext, typeof SEARCH_VAULT_PARAMS> = {
  name: "search_vault",
  label: "Search vault",
  description:
    "Search the user's vault and return the most relevant notes as paths with short excerpts. Follow up with read_note to read one in full.",
  parameters: SEARCH_VAULT_PARAMS,
  execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
    const hits = await context.searchVault(params.query);
    if (hits.length === 0) {
      return textResult(`No notes matched "${params.query}".`, { hits: [] });
    }
    const rendered = hits.map((hit) => `## ${hit.path}\n\n${hit.excerpt}`).join("\n\n");
    return textResult(rendered, { hits: hits.map((hit) => hit.path) });
  },
};
