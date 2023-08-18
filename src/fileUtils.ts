import { TFile } from 'obsidian';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import AIState from './aiState';
import { loadPdfJs } from 'obsidian';

import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

export async function getFileContents(file: TFile): Promise<string | null> {
  if (file.extension != "md") return null;
  return await this.app.vault.read(file);
}

export async function useActiveFileAsContext(aiState: AIState) {
  let file = this.app.workspace.getActiveFile();
  if (file.extension == "pdf") {
    await readPDF(file, aiState);
    return;
  }
  console.log("FILE IS", file);
}

async function readPDF(file: TFile, aiState: AIState) {
  console.log("FILE IS", file)
  let pdfBinary = await this.app.vault.readBinary(file);

  let pdfjsLib = await loadPdfJs();
  let doc = await pdfjsLib.getDocument(pdfBinary).promise;

  let textContent = [];
  let ids = [];
  for (let i = 0; i < doc.numPages; i++) {
    let page = await doc.getPage(i + 1);
    let text = await page.getTextContent();
    textContent.push(text.items.map(item => item.str).join(" "));
    ids.push({ id: i });
  }

  const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 });

  const docs = await textSplitter.createDocuments(textContent);

  console.log('Creating vector store...');
  let vectorStore = await MemoryVectorStore.fromDocuments(
    docs, aiState.getEmbeddingsAPI(),
  );

  const resultOne = await vectorStore.similaritySearch("math", 1)
  console.log("RESULT ONE IS", resultOne)
}