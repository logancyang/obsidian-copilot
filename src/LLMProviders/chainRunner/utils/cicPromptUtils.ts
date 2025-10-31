/**
 * Helper utilities for assembling Corpus-in-Context (CiC) ordered tool payloads.
 */

/**
 * Builds the ordered inner payload for a localSearch result, placing optional lead-in
 * instructions ahead of the serialized documents.
 * @param introText Context-setting instructions to show before the documents.
 * @param formattedContent Serialized documents selected for inclusion.
 * @returns Combined payload string with minimal whitespace.
 */
export function buildLocalSearchInnerContent(introText: string, formattedContent: string): string {
  const sections = [introText, formattedContent]
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
 * @returns String formatted according to CiC ordering.
 */
export function renderCiCMessage(contextSection: string, userQuestion: string): string {
  const contextBlock = contextSection.trim();
  if (!contextBlock) {
    return userQuestion;
  }

  return `${contextBlock}\n\n${userQuestion}`;
}

/**
 * Ensure a CiC payload appends the user's question with a "[User query]:" label, avoiding duplicates when the question already exists.
 * Uses the same label format as LayerToMessagesConverter for consistency across chains.
 * Used in AutonomousAgent to clearly separate tool results from the original user query.
 * @param localSearchPayload XML-wrapped local search payload.
 * @param originalUserQuestion The original user question to append.
 * @returns CiC ordered payload with the labeled question appended when missing.
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

  // Use same label format as LayerToMessagesConverter for consistency
  return renderCiCMessage(localSearchPayload, `[User query]:\n${trimmedQuestion}`);
}

/**
 * Inserts citation guidance immediately before the user query label, keeping tool context intact.
 * @param payload Serialized CiC payload containing tool outputs and user query.
 * @param guidance Guidance block (typically <guidance>...</guidance>) to insert.
 * @returns Payload with guidance positioned before `[User query]:` or appended when label missing.
 */
export function injectGuidanceBeforeUserQuery(payload: string, guidance?: string | null): string {
  const trimmedGuidance = guidance?.trim();
  if (!trimmedGuidance) {
    return payload;
  }

  const userQueryLabel = "[User query]:";
  const labelIndex = payload.indexOf(userQueryLabel);
  if (labelIndex === -1) {
    const trimmedPayload = payload.trimEnd();
    const joiner = trimmedPayload.length > 0 ? "\n\n" : "";
    return `${trimmedPayload}${joiner}${trimmedGuidance}`;
  }

  const prefix = payload.slice(0, labelIndex).trimEnd();
  const suffix = payload.slice(labelIndex).trimStart();

  return `${prefix}\n\n${trimmedGuidance}\n\n${suffix}`;
}
