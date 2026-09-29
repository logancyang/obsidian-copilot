export function buildLocalSearchInnerContent(introText: string, formattedContent: string): string {
  const sections = [introText, formattedContent]
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section));

  return sections.join("\n\n");
}

export function wrapLocalSearchPayload(innerContent: string, timeExpression: string): string {
  const payload = innerContent ? `\n${innerContent}\n` : "";
  const timeAttribute = timeExpression ? ` timeRange="${timeExpression}"` : "";
  return `<localSearch${timeAttribute}>${payload}</localSearch>`;
}

export function renderCiCMessage(contextSection: string, userQuestion: string): string {
  const contextBlock = contextSection.trim();
  if (!contextBlock) {
    return userQuestion;
  }

  return `${contextBlock}\n\n${userQuestion}`;
}

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

  return renderCiCMessage(localSearchPayload, `[User query]:\n${trimmedQuestion}`);
}

export function injectGuidanceBeforeUserQuery(payload: string, guidance?: string | null): string {
  const trimmedGuidance = guidance?.trim();
  if (!trimmedGuidance) {
    return payload;
  }

  const userQueryLabel = "[User query]:";
  const labelIndex = payload.lastIndexOf(userQueryLabel);
  if (labelIndex === -1) {
    const trimmedPayload = payload.trimEnd();
    const joiner = trimmedPayload.length > 0 ? "\n\n" : "";
    return `${trimmedPayload}${joiner}${trimmedGuidance}`;
  }

  const prefix = payload.slice(0, labelIndex).trimEnd();
  const suffix = payload.slice(labelIndex).trimStart();

  return `${prefix}\n\n${trimmedGuidance}\n\n${suffix}`;
}
