import { logError, logInfo, logWarn } from "@/logger";
import { ensureFolderExists } from "@/utils";
import { TFile, Vault } from "obsidian";

/**
 * Save converted document content to the specified output folder.
 * Uses flat naming: {basename}.md, disambiguating with double-underscore
 * path flattening on collision. No-op when outputFolder is empty, content
 * is empty/error, or source is already markdown.
 *
 * @param file - Source file that was converted.
 * @param content - Converted markdown content.
 * @param vault - Obsidian vault instance.
 * @param outputFolder - Target folder path (empty string = disabled).
 */
export async function saveConvertedDocOutput(
  file: TFile,
  content: string,
  vault: Vault,
  outputFolder: string
): Promise<void> {
  const trimmed = outputFolder?.trim();
  if (!trimmed) return;

  // Skip markdown files — they don't need conversion output
  if (file.extension === "md") return;

  // Skip empty or error content
  if (!content || content.startsWith("[Error:")) return;

  try {
    await ensureFolderExists(trimmed);

    let outputPath = `${trimmed}/${file.basename}.md`;

    // Disambiguate if a file with the same name already exists from a different source
    if (await vault.adapter.exists(outputPath)) {
      const existing = await vault.adapter.read(outputPath);
      if (existing && !existing.startsWith(`<!-- source: ${file.path} -->`)) {
        // Use full path to guarantee uniqueness even when path separators
        // were part of the original folder name (e.g. a/b/x.pdf vs a_b/x.pdf)
        const safePath = file.path.replace(/\.[^.]+$/, "").replace(/[/\\]/g, "__");
        outputPath = `${trimmed}/${safePath}.md`;

        // Final guard: if the disambiguated path also exists from a different source, skip
        if (await vault.adapter.exists(outputPath)) {
          const existingDisambig = await vault.adapter.read(outputPath);
          if (existingDisambig && !existingDisambig.startsWith(`<!-- source: ${file.path} -->`)) {
            logWarn(`Skipping converted doc output for ${file.path}: collision at ${outputPath}`);
            return;
          }
        }
      }
    }

    // Prepend source path as a comment for traceability and collision detection
    const outputContent = `<!-- source: ${file.path} -->\n${content}`;

    // Skip write when content is unchanged to avoid mtime churn and re-indexing
    if (await vault.adapter.exists(outputPath)) {
      const existing = await vault.adapter.read(outputPath);
      if (existing === outputContent) return;
    }

    await vault.adapter.write(outputPath, outputContent);
    logInfo(`Saved converted doc output: ${outputPath}`);
  } catch (error) {
    logError(`Failed to save converted doc output for ${file.path}:`, error);
  }
}
