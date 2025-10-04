import { PromptSection, joinPromptSections } from "./modelAdapter";
import { processRawChatHistory, processedMessagesToTextOnly } from "./chatHistoryUtils";

/**
 * Options for building prompt debug sections with annotated provenance.
 */
export interface BuildPromptDebugSectionsOptions {
  systemSections: PromptSection[];
  rawHistory?: any[];
  adapterName: string;
  originalUserMessage: string;
  enhancedUserMessage: string;
}

/**
 * Resulting debug report containing structured sections and the annotated string representation.
 */
export interface PromptDebugReport {
  sections: PromptSection[];
  annotatedPrompt: string;
  systemPrompt: string;
}

/**
 * Build ordered prompt sections that include system prompt components, optional chat history, and user messages.
 *
 * @param options - Data required to assemble annotated prompt sections.
 * @returns Prompt sections with provenance metadata.
 */
export function buildPromptDebugSections(
  options: BuildPromptDebugSectionsOptions
): PromptSection[] {
  const { systemSections, rawHistory, adapterName, originalUserMessage, enhancedUserMessage } =
    options;
  const sections: PromptSection[] = [...systemSections];

  if (rawHistory && rawHistory.length > 0) {
    const processedHistory = processRawChatHistory(rawHistory);
    if (processedHistory.length > 0) {
      const textHistory = processedMessagesToTextOnly(processedHistory);
      const historyLines = textHistory.map((entry, index) => {
        return `${index + 1}. ${entry.role.toUpperCase()}\n${entry.content}`;
      });

      sections.push({
        id: "chat-history",
        label: "Restored chat history from memory",
        source: "src/LLMProviders/chainRunner/utils/chatHistoryUtils.ts#processRawChatHistory",
        content: historyLines.join("\n\n"),
      });
    }
  }

  sections.push({
    id: "user-original-message",
    label: "Original user message",
    source: "Chat input",
    content: originalUserMessage,
  });

  const adapterLabelSuffix = enhancedUserMessage === originalUserMessage ? " (unchanged)" : "";

  sections.push({
    id: "user-enhanced-message",
    label: `User message after ${adapterName}.enhanceUserMessage${adapterLabelSuffix}`,
    source: `src/LLMProviders/chainRunner/utils/modelAdapter.ts#${adapterName}.enhanceUserMessage`,
    content: enhancedUserMessage,
  });

  return sections;
}

/**
 * Format prompt sections into an annotated string that highlights each section's origin.
 *
 * @param sections - Prompt sections with provenance metadata.
 * @returns Multiline string with section headers that identify code sources.
 */
export function formatPromptSectionsWithAnnotations(sections: PromptSection[]): string {
  return sections
    .map((section) => {
      const header = `[Section: ${section.label} | Source: ${section.source}]`;
      return `${header}\n${section.content}`;
    })
    .join("\n\n");
}

/**
 * Build a complete prompt debug report containing structured sections and the annotated string output.
 *
 * @param options - Data required to assemble annotated prompt sections.
 * @returns Report including sections, annotated prompt, and the raw system prompt string.
 */
export function buildPromptDebugReport(
  options: BuildPromptDebugSectionsOptions
): PromptDebugReport {
  const sections = buildPromptDebugSections(options);
  const annotatedPrompt = formatPromptSectionsWithAnnotations(sections);
  const systemPrompt = joinPromptSections(options.systemSections);

  return {
    sections,
    annotatedPrompt,
    systemPrompt,
  };
}
