import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { Card, CardTitle, CardContent, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { useSettingsValue } from "@/settings/model";
import { PlusCircle, TriangleAlert } from "lucide-react";
import React, { useMemo } from "react";

interface NotePrompt {
  title: string;
  prompts: string[];
}
const SUGGESTED_PROMPTS: Record<string, NotePrompt> = {
  activeNote: {
    title: "Active Note Insights",
    prompts: [
      `Provide three follow-up questions worded as if I'm asking you based on {activeNote}?`,
      `What key questions does {activeNote} answer?`,
      `Give me a quick recap of {activeNote} in two sentences.`,
    ],
  },
  quoteNote: {
    title: "Note Link Chat",
    prompts: [
      `Based on [[<note>]], what improvements should we focus on next?`,
      `Summarize the key points from [[<note>]].`,
      `Summarize the recent updates from [[<note>]].`,
      `Roast my writing in [[<note>]] and give concrete actionable feedback`,
    ],
  },
  fun: {
    title: "Test LLM",
    prompts: [
      `9.11 and 9.8, which is bigger?`,
      `What's the longest river in the world?`,
      `If a lead ball and a feather are dropped simultaneously from the same height, which will reach the ground first?`,
    ],
  },
  qaVault: {
    title: "Vault Q&A",
    prompts: [
      `What insights can I gather about <topic> from my notes?`,
      `Explain <concept> based on my stored notes.`,
      `Highlight important details on <topic> from my notes.`,
      `Based on my notes on <topic>, what is the question that I should be asking, but am not?`,
    ],
  },
  copilotPlus: {
    title: "Copilot Plus",
    prompts: [
      `Give me a recap of last week @vault`,
      `What are the key takeaways from my notes on <topic> @vault`,
      `Summarize <url> in under 10 bullet points`,
      `@youtube <video_url>`,
      `@web what are most recent updates in the AI industry`,
      `What are the key insights from this paper <arxiv_url>`,
      `What new methods are proposed in this paper [[<note_with_embedded_pdf>]]`,
    ],
  },
};

const PROMPT_KEYS: Record<ChainType, Array<keyof typeof SUGGESTED_PROMPTS>> = {
  [ChainType.LLM_CHAIN]: ["activeNote", "quoteNote", "fun"],
  [ChainType.VAULT_QA_CHAIN]: ["qaVault", "qaVault", "quoteNote"],
  [ChainType.COPILOT_PLUS_CHAIN]: ["copilotPlus", "copilotPlus", "copilotPlus"],
};

function getRandomPrompt(chainType: ChainType = ChainType.LLM_CHAIN) {
  const keys = PROMPT_KEYS[chainType] || PROMPT_KEYS[ChainType.LLM_CHAIN];

  // For repeated keys, shuffle once and take multiple items
  const shuffledPrompts: Record<string, string[]> = {};

  return keys.map((key) => {
    if (!shuffledPrompts[key]) {
      shuffledPrompts[key] = [...SUGGESTED_PROMPTS[key].prompts].sort(() => Math.random() - 0.5);
    }
    return {
      title: SUGGESTED_PROMPTS[key].title,
      text: shuffledPrompts[key].pop() || SUGGESTED_PROMPTS[key].prompts[0],
    };
  });
}

interface SuggestedPromptsProps {
  onClick: (text: string) => void;
}

export const SuggestedPrompts: React.FC<SuggestedPromptsProps> = ({ onClick }) => {
  const [chainType] = useChainType();
  const prompts = useMemo(() => getRandomPrompt(chainType), [chainType]);
  const settings = useSettingsValue();
  const indexVaultToVectorStore = settings.indexVaultToVectorStore as VAULT_VECTOR_STORE_STRATEGY;

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full bg-transparent">
        <CardHeader className="px-2">
          <CardTitle>Suggested Prompts</CardTitle>
        </CardHeader>
        <CardContent className="p-2 px-2 pt-0">
          <div className="flex flex-col gap-2">
            {prompts.map((prompt, i) => (
              <div
                key={i}
                className="flex gap-2 p-2 justify-between text-sm rounded-md border border-border border-solid"
              >
                <div className="flex flex-col gap-1">
                  <div className="text-muted">{prompt.title}</div>
                  <div>{prompt.text}</div>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="size-6 p-0 !bg-transparent border-none !shadow-none hover:!bg-interactive-hover"
                      onClick={() => onClick(prompt.text)}
                    >
                      <PlusCircle className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Add to Chat</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      {chainType === ChainType.VAULT_QA_CHAIN && (
        <div className="text-sm border border-border border-solid p-2 rounded-md">
          Please note that this is a retrieval-based QA. Questions should contain keywords and
          concepts that exist literally in your vault
        </div>
      )}
      {chainType === ChainType.VAULT_QA_CHAIN &&
        indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.NEVER && (
          <div className="text-sm border border-border border-solid p-2 rounded-md">
            <div>
              <TriangleAlert className="size-4" /> Your auto-index strategy is set to <b>NEVER</b>.
              Before proceeding, click the <span className="text-accent">Refresh Index</span> button
              below or run the{" "}
              <span className="text-accent">Copilot command: Index (refresh) vault for QA</span> to
              update the index.
            </div>
          </div>
        )}
    </div>
  );
};
