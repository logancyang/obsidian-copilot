function wrapErrorChunk(errorMessage: string): string {
  return `<errorChunk>${errorMessage}</errorChunk>`;
}

export function formatErrorChunk(errorMessage: string, prefix?: string): string {
  const errorChunk = wrapErrorChunk(errorMessage);
  if (prefix) {
    return `${prefix}\n${errorChunk}`;
  }
  return `\n${errorChunk}`;
}
