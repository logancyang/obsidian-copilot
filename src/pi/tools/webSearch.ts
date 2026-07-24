import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { PiToolContext } from "./index";
import { textResult } from "./toolResult";

const WEB_SEARCH_PARAMS = Type.Object({
  query: Type.String({ description: "What to search the web for." }),
});

/** Answers questions the vault cannot, via the Copilot Plus web search relay. */
export const webSearchTool: AgentHarnessTool<PiToolContext, typeof WEB_SEARCH_PARAMS> = {
  name: "web_search",
  label: "Search the web",
  description:
    "Search the web for current information the vault does not contain. Returns an answer with its sources.",
  parameters: WEB_SEARCH_PARAMS,
  execute: async (_toolCallId, params, _signal, _onUpdate, context) => {
    const answer = await context.webSearch(params.query);
    return textResult(answer, { query: params.query });
  },
};
