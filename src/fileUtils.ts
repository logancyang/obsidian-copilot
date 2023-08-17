import { TFile } from 'obsidian';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import AIState from './aiState';
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.entry';
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
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  
  let pdfBinary = await this.app.vault.readBinary(file);

  console.log("PDF BINARY IS", pdfBinary)
  let doc = await pdfjsLib.getDocument(pdfBinary).promise;

  console.log("DOC IS", doc)
  // Example of MemoryVectorStore.fromTexts:
  // const vectorStore = await MemoryVectorStore.fromTexts(
  //   ["Hello world", "Bye bye", "hello nice world"],
  //   [{ id: 2 }, { id: 1 }, { id: 3 }],
  //   new OpenAIEmbeddings(),
  //   { similarity: similarity.pearson }
  // );
  // Transform doc to fit this format

  let textContent = [];
  let ids = [];
  for (let i = 0; i < doc.numPages; i++) {
    let page = await doc.getPage(i + 1);
    let text = await page.getTextContent();
    textContent.push(text.items.map(item => item.str).join(" "));
    ids.push({ id: i });
  }


  // const loader = new PDFLoader("");

  // const docs = await loader.load();
  // console.log("DOCS ARE", docs)

  const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 });

  const docs = await textSplitter.createDocuments(textContent);

  console.log('Creating vector store...');
  let vectorStore = await MemoryVectorStore.fromDocuments(
    docs, aiState.getEmbeddingsAPI(),
  );

  // const vectorStore = await MemoryVectorStore.fromTexts(
  //   textContent,
  //   ids,
  //   aiState.getEmbeddingsAPI(),
  // )

  const resultOne = await vectorStore.similaritySearch("math", 1)
  console.log("RESULT ONE IS", resultOne)
}