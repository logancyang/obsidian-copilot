import { App, TFile, loadPdfJs } from "obsidian";

async function loadPDF(app: App, file: TFile) {
  const PDFJS = await loadPdfJs();
  const pdfBinary = await app.vault.readBinary(file);
  const doc = await PDFJS.getDocument(pdfBinary).promise;
  return doc;
}

export function isFilePDF(file: TFile | null): boolean {
  if (!file) {
    return false;
  }
  return file.extension === "pdf";
}

/**
 * Retrieves all the text content of a PDF file.
 * @param app The Obsidian App object.
 * @param file The PDF file to read.
 * @returns A Promise that resolves to the text content of the PDF file.
 */
export async function getAllPDFText(app: App, file: TFile): Promise<string | null> {
  const doc = await loadPDF(app, file);

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

export async function extractPDFHighlights(app: App, file: TFile | null) {
  if (!file) {
    return null;
  }

  const pdf = await loadPDF(app, file);
  const highlights: string[] = [];
  const numPages = pdf.numPages;
  const promises = Array.from({ length: numPages }, (_, i) => {
    const pageNumber = i + 1;
    const page = pdf.getPage(pageNumber);
    return page.getAnnotations().then((annotations) => {
      const highlightAnnotations = annotations.filter((annotation) => annotation.subtype === 'Highlight');
      const highlightTextPromises = highlightAnnotations.map((highlight) => {
        const highlightRect = highlight.rect;
        return page.getTextContent().then((textContent) => {
          const textItems = textContent.items;
          const highlightTextItems = textItems.filter((textItem) => {
            const itemRect = textItem.transformedRect;
            return (
              itemRect[0] >= highlightRect[0] &&
              itemRect[1] >= highlightRect[1] &&
              itemRect[2] <= highlightRect[2] &&
              itemRect[3] <= highlightRect[3]
            );
          });
          const highlightText = highlightTextItems.map((textItem) => textItem.str).join('');
          return highlightText;
        });
      });
      return Promise.all(highlightTextPromises).then((highlightTexts) => {
        highlights.push(...highlightTexts);
      });
    });
  });
  return Promise.all(promises).then(() => {
    console.log(highlights);
  });
}


export async function extractSelectedText() {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  console.log("SELECTION TO STRING IS", selection.toString())
}

export const FileUtils = {
	getAllPDFText,
  extractPDFHighlights,
  isFilePDF,
  extractSelectedText,
}