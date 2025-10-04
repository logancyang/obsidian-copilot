/**
 * Helper utilities for assembling Corpus-in-Context (CiC) ordered tool payloads.
 */

/**
 * Builds the ordered inner payload for a localSearch result, placing guidance before documents.
 * @param guidance Citation guidance or instructions associated with the search results.
 * @param formattedContent Serialized documents selected for inclusion.
 * @returns Combined payload string with minimal whitespace.
 */
export function buildLocalSearchInnerContent(guidance: string, formattedContent: string): string {
  const sections = [guidance, formattedContent]
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section));

  return sections.join("\n\n");
}

/**
 * Wraps localSearch payload content in XML, preserving optional time range metadata.
 * @param innerContent Ordered combination of guidance and documents.
 * @param timeExpression Optional natural-language time range expression.
 * @returns XML-wrapped localSearch payload ready for LLM consumption.
 */
export function wrapLocalSearchPayload(innerContent: string, timeExpression: string): string {
  const payload = innerContent ? `\n${innerContent}\n` : "";
  const timeAttribute = timeExpression ? ` timeRange="${timeExpression}"` : "";
  return `<localSearch${timeAttribute}>${payload}</localSearch>`;
}

/**
 * Produces a CiC-aligned prompt by placing context first and the user question last.
 * @param contextSection Prepared instruction/context block.
 * @param userQuestion Original user message.
 * @param labelQuestion Whether to prefix the question with a clarifying label.
 * @returns String formatted according to CiC ordering.
 */
export function renderCiCMessage(
  contextSection: string,
  userQuestion: string,
  labelQuestion: boolean
): string {
  const contextBlock = contextSection.trim();
  if (!contextBlock) {
    return userQuestion;
  }

  const questionBlock = labelQuestion ? `Question: ${userQuestion}` : userQuestion;
  return `${contextBlock}\n\n${questionBlock}`;
}

/**
 * Ensure a CiC payload appends the user's question, avoiding duplicates when the question already exists.
 * @param localSearchPayload XML-wrapped local search payload.
 * @param originalUserQuestion The original user question to append.
 * @returns CiC ordered payload with the question appended when missing.
 */
export function ensureCiCOrderingWithQuestion(
  localSearchPayload: string,
  originalUserQuestion: string
): string {
  const trimmedQuestion = originalUserQuestion.trim();

  if (!trimmedQuestion) {
    return localSearchPayload;
  }

  if (localSearchPayload.includes(trimmedQuestion)) {
    return localSearchPayload;
  }

  return renderCiCMessage(localSearchPayload, trimmedQuestion, true);
}
