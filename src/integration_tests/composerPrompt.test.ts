import { DEFAULT_SYSTEM_PROMPT, COMPOSER_OUTPUT_INSTRUCTIONS } from "../constants";
import * as dotenv from "dotenv";
import { jest } from "@jest/globals";
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  GenerativeModel,
} from "@google/generative-ai";

// Add global fetch polyfill for Node.js environments
import fetch, { Headers, Request, Response } from "node-fetch";
if (!globalThis.fetch) {
  globalThis.fetch = fetch as any;
  globalThis.Headers = Headers as any;
  globalThis.Request = Request as any;
  globalThis.Response = Response as any;
}

// Load environment variables from .env.test
dotenv.config({ path: ".env.test" });

// Test data
const atom_note = `Atoms are the basic particles of the chemical elements. An atom consists of a nucleus of protons and generally neutrons, surrounded by an electromagnetically bound swarm of electrons. The chemical elements are distinguished from each other by the number of protons that are in their atoms. For example, any atom that contains 11 protons is sodium, and any atom that contains 29 protons is copper. Atoms with the same number of protons but a different number of neutrons are called isotopes of the same element.

Atoms are extremely small, typically around 100 picometers across. A human hair is about a million carbon atoms wide. Atoms are smaller than the shortest wavelength of visible light, which means humans cannot see atoms with conventional microscopes. They are so small that accurately predicting their behavior using classical physics is not possible due to quantum effects.`;

// Increase test timeout to 30 seconds
jest.setTimeout(30000);

jest.mock("../encryptionService", () => ({
  getDecryptedKey: jest.fn().mockImplementation((key) => Promise.resolve(key)),
}));

describe("Composer Instructions - Integration Tests", () => {
  let genAI: GoogleGenerativeAI;
  let model: GenerativeModel;

  beforeAll(() => {
    // Log for debugging
    console.log("Starting tests, API key available:", !!process.env.GEMINI_API_KEY);

    // Fail tests if no API key is available
    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY not found in .env.test - integration tests require a valid API key"
      );
    }

    // Initialize Google Generative AI client directly with the SDK
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1000,
      },
      systemInstruction: DEFAULT_SYSTEM_PROMPT,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    });
  });

  // Helper function to run a test with a given prompt and check for composer blocks
  const testComposerResponse = async (
    testName: string,
    userPrompt: string,
    expectedBlocks: number = 1
  ) => {
    test(testName, async () => {
      try {
        // Create chat session and send message
        const chat = model.startChat();
        const result = await chat.sendMessage(
          userPrompt + "\n\n<output_format>\n" + COMPOSER_OUTPUT_INSTRUCTIONS + "\n</output_format>"
        );
        const content = result.response.text();
        if (expectedBlocks == 0) {
          expect(content).not.toContain('"type": "composer"');
          return;
        } else {
          let composerBlocks = [];
          // When only one block is expected, find the first { and last } and parse the JSON
          if (expectedBlocks == 1) {
            const start = content.indexOf("{");
            const end = content.lastIndexOf("}");
            composerBlocks.push(content.substring(start, end + 1));
          } else {
            const blocks = content.match(
              /{\s*"type":\s*"composer",\s*"path":\s*"[^"]+\.(md|canvas)"[\s\S]*?}/g
            );
            expect(blocks).toBeTruthy();
            composerBlocks = blocks!;
            expect(composerBlocks.length).toBe(expectedBlocks);
          }

          // Validate each block is valid JSON
          composerBlocks!.forEach((block, index) => {
            try {
              const json = JSON.parse(block);
              expect(json).toHaveProperty("type", "composer");
              expect(json).toHaveProperty("path");
              expect(json.path).toMatch(/\.(md|canvas)$/);
              if (json.path.endsWith(".canvas")) {
                expect(json).toHaveProperty("canvas_json");
                expect(json.canvas_json).toHaveProperty("nodes");
              } else {
                expect(json).toHaveProperty("content");
              }
            } catch (e) {
              throw new Error(`Invalid JSON in block ${block}: ${e.message}`);
            }
          });
        }

        // Log preview for inspection
        console.log(`${testName} - Response preview:`, content.substring(0, 100) + "...");
      } catch (error) {
        console.error(`${testName} error:`, error);
        throw error;
      }
    });
  };

  // Run tests with different prompts
  testComposerResponse(
    "Composer: create a new note",
    "@composer Create a new note about climate change?"
  );

  testComposerResponse(
    "Composer: add content to a note",
    `Add a tl;dr to [[atom]].

     Title: [[atom]] 
     Path: atom.md
     ${atom_note}`
  );

  testComposerResponse(
    "Composer: rewrite a note",
    `@composer Rewrite the note [[atom]] to be more concise.

     Title: [[atom]] 
     Path: atom.md
     ${atom_note}`
  );

  testComposerResponse(
    "Composer: remove content from a note",
    `@composer Remove the second paragraph.

     Title: [[atom]] 
     Path: atom.md
     ${atom_note}`
  );

  testComposerResponse(
    "Composer: update multiple notes",
    "@composer Create two notes on the topic of Earth and Mars separately",
    2
  );

  testComposerResponse(
    "Composer: create a canvas",
    "@composer Create a canvas about water cycle",
    1
  );
});
