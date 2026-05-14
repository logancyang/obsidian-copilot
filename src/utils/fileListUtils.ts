/**
 * Returns a stable identity key for a browser File object.
 */
export function getFileIdentityKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}-${file.type}`;
}

/**
 * Appends incoming files while preserving order and skipping files already present.
 */
export function appendUniqueFiles(existingFiles: File[], incomingFiles: File[]): File[] {
  if (incomingFiles.length === 0) {
    return existingFiles;
  }

  const seenKeys = new Set(existingFiles.map(getFileIdentityKey));
  const uniqueIncomingFiles = incomingFiles.filter((file) => {
    const key = getFileIdentityKey(file);
    if (seenKeys.has(key)) {
      return false;
    }
    seenKeys.add(key);
    return true;
  });

  if (uniqueIncomingFiles.length === 0) {
    return existingFiles;
  }

  return [...existingFiles, ...uniqueIncomingFiles];
}
