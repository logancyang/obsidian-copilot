function wrapErrorChunk(errorMessage: string): string {
  return `<errorChunk>${errorMessage}</errorChunk>`;
}

export function formatErrorChunk(errorMessage: string): string {
  return `\n${wrapErrorChunk(errorMessage)}`;
}
