import { App, TFile, loadPdfJs } from "obsidian";

/**
 * Retrieves all the text content of a PDF file.
 * @param app The Obsidian App object.
 * @param file The PDF file to read.
 * @returns A Promise that resolves to the text content of the PDF file.
 */
export async function getAllPDFText(app: App, file: TFile): Promise<string | null> {
  const PDFJS = await loadPdfJs();

  const pdfBinary = await app.vault.readBinary(file);
  const doc = await PDFJS.getDocument(pdfBinary).promise;

  let textContent = [];
  for (let i = 0; i < doc.numPages; i++) {
    let page = await doc.getPage(i + 1);
    let text = await page.getTextContent();

    if (text.items.length > 0) {
      let pageText = text.items.map((item: any) => item.str).join(" ");
      pageText = pageText.replace(/\s+/g, ' ').trim(); // Remove potentially duplicated spaces
      textContent.push(pageText);
    }
  }

  if (textContent.length == 0) {
    return null;
  }
  return textContent.join("");
}

export const FileUtils = {
	getAllPDFText
}