import { logError, logInfo, logWarn } from "@/logger";
import { ensureFolderExists } from "@/utils";
import { TFile, Vault } from "obsidian";

export async function saveConvertedDocOutput(
  file: TFile,
  content: string,
  vault: Vault,
  outputFolder: string
): Promise<void> {
  const trimmed = outputFolder?.trim();
  if (!trimmed) return;

  if (file.extension === "md") return;

  if (!content || content.startsWith("[Error:")) return;

  try {
    await ensureFolderExists(vault, trimmed);

    let outputPath = `${trimmed}/${file.basename}.md`;

    if (await vault.adapter.exists(outputPath)) {
      const existing = await vault.adapter.read(outputPath);
      if (existing && !existing.startsWith(`<!-- source: ${file.path} -->`)) {
        const safePath = file.path.replace(/\.[^.]+$/, "").replace(/[/\\]/g, "__");
        outputPath = `${trimmed}/${safePath}.md`;

        if (await vault.adapter.exists(outputPath)) {
          const existingDisambig = await vault.adapter.read(outputPath);
          if (existingDisambig && !existingDisambig.startsWith(`<!-- source: ${file.path} -->`)) {
            logWarn(`Skipping converted doc output for ${file.path}: collision at ${outputPath}`);
            return;
          }
        }
      }
    }

    const outputContent = `<!-- source: ${file.path} -->\n${content}`;

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
