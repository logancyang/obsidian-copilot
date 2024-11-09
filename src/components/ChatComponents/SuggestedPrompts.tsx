import { ChainType } from "@/chainFactory";
import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
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
};

const PROMPT_KEYS: Record<ChainType, Array<keyof typeof SUGGESTED_PROMPTS>> = {
  [ChainType.LLM_CHAIN]: ["activeNote", "quoteNote", "fun"],
  [ChainType.VAULT_QA_CHAIN]: ["qaVault", "qaVault", "quoteNote"],
  [ChainType.COPILOT_PLUS_CHAIN]: ["activeNote", "quoteNote", "fun"],
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
  chainType: ChainType;
  indexVaultToVectorStore: VAULT_VECTOR_STORE_STRATEGY;
  onClick: (text: string) => void;
}

export const SuggestedPrompts: React.FC<SuggestedPromptsProps> = ({
  chainType,
  indexVaultToVectorStore,
  onClick,
}) => {
  const prompts = useMemo(() => getRandomPrompt(chainType), [chainType]);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          alignItems: "center",
          width: "100%",
          height: "100%",
          flex: 1,
          display: "flex",
          justifyContent: "center",
          flexDirection: "column",
        }}
      >
        <div style={{ width: "400px" }}>
          <p>
            <b>Suggested Prompts</b>
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            {prompts.map((prompt, i) => (
              <button
                key={i}
                onClick={() => onClick(prompt.text)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "fit-content",
                  gap: "0.5rem",
                  alignItems: "start",
                  padding: "0.5rem 1rem",
                  width: "400px",
                  whiteSpace: "normal",
                  textAlign: "left",
                }}
              >
                <div style={{ color: "var(--text-muted)" }}>{prompt.title}</div>
                <div>{prompt.text}</div>
              </button>
            ))}
          </div>
          {chainType === ChainType.VAULT_QA_CHAIN && (
            <p
              style={{
                border: "1px solid var(--background-modifier-border)",
                padding: "0.5rem",
                borderRadius: "var(--radius-s)",
              }}
            >
              Please note that this is a retrieval-based QA. Questions should contain keywords and
              concepts that exist literally in your vault
            </p>
          )}
          {chainType === ChainType.VAULT_QA_CHAIN &&
            indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.NEVER && (
              <p
                style={{
                  border: "1px solid var(--background-modifier-border)",
                  padding: "0.5rem",
                  borderRadius: "var(--radius-s)",
                }}
              >
                ⚠️ Your auto-index strategy is set to <b>NEVER</b>. Before proceeding, click the{" "}
                <span style={{ color: "var(--color-blue" }}>Refresh Index</span> button below or run
                the{" "}
                <span style={{ color: "var(--color-blue" }}>
                  Copilot command: Index (refresh) vault for QA
                </span>{" "}
                to update the index.
              </p>
            )}
        </div>
      </div>
    </div>
  );
};
