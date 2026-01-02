/**
 * Discuss Feature System Prompts
 *
 * System prompts for the project-focused discussion feature in Projects+.
 */

/**
 * Parameters for building the discuss system prompt
 */
export interface DiscussSystemPromptParams {
  projectTitle: string;
  projectDescription: string;
  successCriteria: string[];
}

/**
 * Build the system prompt for project-focused discussion
 */
export function buildDiscussSystemPrompt(params: DiscussSystemPromptParams): string {
  const { projectTitle, projectDescription, successCriteria } = params;

  const criteriaText =
    successCriteria.length > 0
      ? successCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
      : "Not specified";

  return `You are a focused project assistant helping the user work on their project.

## Project Context
**Project:** ${projectTitle}
**Description:** ${projectDescription}
**Success Criteria:**
${criteriaText}

## Guidelines
1. Keep discussions focused on the project and its goals
2. Reference the user's notes when answering questions
3. If asked about unrelated topics, gently acknowledge and redirect to the project
4. When citing information from notes, clearly indicate the source
5. Be concise but thorough
6. Help the user make progress toward the success criteria

## Source Citation Format
When referencing information from the user's notes, end your response with:

**Sources:**
- [[note-name-1]]
- [[note-name-2]]

Only include notes you actually referenced in your answer.`;
}

/**
 * Prompt template for generating suggested questions at conversation start
 */
export const SUGGESTED_QUESTIONS_PROMPT = `Based on this project and its notes, generate 3-4 thoughtful questions that would help the user make progress on their project.

Focus on:
- Questions that connect different notes together
- Questions that help clarify next steps
- Questions about potential challenges or gaps
- Questions that build on existing knowledge

Return ONLY a JSON array of questions, no other text:
["Question 1?", "Question 2?", "Question 3?"]

Project: {projectTitle}
Description: {projectDescription}
Success Criteria: {successCriteria}

Notes Summary:
{notesSummary}`;

/**
 * Build the suggested questions prompt with project context
 */
export function buildSuggestedQuestionsPrompt(params: {
  projectTitle: string;
  projectDescription: string;
  successCriteria: string[];
  notesSummary: string;
}): string {
  const { projectTitle, projectDescription, successCriteria, notesSummary } = params;

  return SUGGESTED_QUESTIONS_PROMPT.replace("{projectTitle}", projectTitle)
    .replace("{projectDescription}", projectDescription)
    .replace("{successCriteria}", successCriteria.join(", ") || "Not specified")
    .replace("{notesSummary}", notesSummary || "No notes assigned");
}

/**
 * Prompt for generating conversation title from first exchange
 */
export const CONVERSATION_TITLE_PROMPT = `Generate a concise title (3-6 words) for this conversation based on the first message exchange.
Return ONLY the title, no quotes or explanation.

User: {userMessage}
Assistant: {assistantMessage}`;

/**
 * Build the conversation title prompt
 */
export function buildConversationTitlePrompt(
  userMessage: string,
  assistantMessage: string
): string {
  return CONVERSATION_TITLE_PROMPT.replace("{userMessage}", userMessage).replace(
    "{assistantMessage}",
    assistantMessage.slice(0, 500) // Limit to first 500 chars
  );
}
