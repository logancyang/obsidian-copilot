import { MessageRepository } from "./MessageRepository";
import { USER_SENDER, SELECTED_TEXT_TAG } from "@/constants";
import { MessageContext } from "@/types/message";
import { TFile } from "obsidian";
import { NoteReference } from "@/types/note";

/**
 * Tests specifically for proper XML tag formatting in context processing
 */
describe("Message Context XML Tag Formatting", () => {
  let messageRepository: MessageRepository;

  beforeEach(() => {
    messageRepository = new MessageRepository();
  });

  it("should format note context with proper XML tags including metadata", () => {
    const userMessage = "Analyze this document";
    const note: TFile = {
      path: "reports/quarterly-review.md",
      name: "quarterly-review.md",
      basename: "quarterly-review",
      extension: "md",
    } as TFile;

    const noteReference = {
      file: note,
    } as NoteReference;

    const context: MessageContext = {
      notes: [noteReference],
      urls: [],
      selectedTextContexts: [],
    };

    const processedText = `Analyze this document

<note_context>
<title>quarterly-review</title>
<path>reports/quarterly-review.md</path>
<ctime>2024-03-15T09:00:00.000Z</ctime>
<mtime>2024-03-20T15:30:00.000Z</mtime>
<content>
# Q1 2024 Quarterly Review

## Performance Metrics
- Revenue: $2.5M (110% of target)
- Customer Acquisition: 450 new customers
- Churn Rate: 2.3% (improved from 3.1%)

## Key Achievements
1. Launched new product feature X
2. Expanded to 3 new markets
3. Improved customer satisfaction score to 92%

## Challenges
- Supply chain delays in March
- Increased competition in segment B
</content>
</note_context>`;

    messageRepository.addMessage(userMessage, processedText, USER_SENDER, context);

    const llmMessages = messageRepository.getLLMMessages();
    expect(llmMessages[0].message).toContain("<note_context>");
    expect(llmMessages[0].message).toContain("<title>quarterly-review</title>");
    expect(llmMessages[0].message).toContain("<path>reports/quarterly-review.md</path>");
    expect(llmMessages[0].message).toContain("<ctime>");
    expect(llmMessages[0].message).toContain("<mtime>");
    expect(llmMessages[0].message).toContain("<content>");
    expect(llmMessages[0].message).toContain("</content>");
    expect(llmMessages[0].message).toContain("</note_context>");
  });

  it("should format URL content with proper XML tags", () => {
    const userMessage = "Summarize this article";
    const context: MessageContext = {
      notes: [],
      urls: ["https://example.com/ai-trends-2024"],
      selectedTextContexts: [],
    };

    const processedText = `Summarize this article

<url_content>
<url>https://example.com/ai-trends-2024</url>
<content>
# AI Trends for 2024

The landscape of artificial intelligence continues to evolve rapidly. Here are the key trends:

1. **Multimodal AI**: Systems that can process and generate content across text, images, audio, and video.

2. **Edge AI**: Moving AI processing closer to where data is generated, reducing latency and improving privacy.

3. **Explainable AI**: Growing demand for AI systems that can explain their decision-making process.

4. **AI Governance**: Increased focus on ethical AI development and regulatory frameworks.

5. **Specialized AI Chips**: Custom hardware designed specifically for AI workloads becoming mainstream.
</content>
</url_content>`;

    messageRepository.addMessage(userMessage, processedText, USER_SENDER, context);

    const llmMessages = messageRepository.getLLMMessages();
    expect(llmMessages[0].message).toContain("<url_content>");
    expect(llmMessages[0].message).toContain("<url>https://example.com/ai-trends-2024</url>");
    expect(llmMessages[0].message).toContain("<content>");
    expect(llmMessages[0].message).toContain("AI Trends for 2024");
    expect(llmMessages[0].message).toContain("</content>");
    expect(llmMessages[0].message).toContain("</url_content>");
  });

  it("should format selected text with proper XML tags", () => {
    const userMessage = "Explain this code snippet";
    const context: MessageContext = {
      notes: [],
      urls: [],
      selectedTextContexts: [
        {
          id: "sel-1",
          content: `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}`,
          noteTitle: "Recursion Examples",
          notePath: "algorithms/recursion.md",
          startLine: 45,
          endLine: 49,
        },
      ],
    };

    const processedText = `Explain this code snippet

<selected_text>
<title>Recursion Examples</title>
<path>algorithms/recursion.md</path>
<start_line>45</start_line>
<end_line>49</end_line>
<content>
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
</content>
</selected_text>`;

    messageRepository.addMessage(userMessage, processedText, USER_SENDER, context);

    const llmMessages = messageRepository.getLLMMessages();
    expect(llmMessages[0].message).toContain(`<${SELECTED_TEXT_TAG}>`);
    expect(llmMessages[0].message).toContain("<title>Recursion Examples</title>");
    expect(llmMessages[0].message).toContain("<path>algorithms/recursion.md</path>");
    expect(llmMessages[0].message).toContain("<start_line>45</start_line>");
    expect(llmMessages[0].message).toContain("<end_line>49</end_line>");
    expect(llmMessages[0].message).toContain("<content>");
    expect(llmMessages[0].message).toContain("function fibonacci");
    expect(llmMessages[0].message).toContain("</content>");
    expect(llmMessages[0].message).toContain(`</${SELECTED_TEXT_TAG}>`);
  });

  it("should handle multiple contexts with proper XML structure", () => {
    const userMessage = "Compare these resources";
    const note: TFile = {
      path: "design-patterns.md",
      name: "design-patterns.md",
      basename: "design-patterns",
      extension: "md",
    } as TFile;

    const noteReference = {
      file: note,
    } as NoteReference;

    const context: MessageContext = {
      notes: [noteReference],
      urls: ["https://patterns.dev/solid-principles"],
      selectedTextContexts: [
        {
          id: "sel-2",
          content:
            "The Single Responsibility Principle states that a class should have only one reason to change.",
          noteTitle: "SOLID Principles",
          notePath: "solid/srp.md",
          startLine: 10,
          endLine: 11,
        },
      ],
    };

    const processedText = `Compare these resources

<note_context>
<title>design-patterns</title>
<path>design-patterns.md</path>
<ctime>2024-02-01T10:00:00.000Z</ctime>
<mtime>2024-02-15T14:00:00.000Z</mtime>
<content>
# Design Patterns Overview

Common solutions to recurring problems in software design.
</content>
</note_context>

<url_content>
<url>https://patterns.dev/solid-principles</url>
<content>
SOLID Principles Guide - comprehensive overview of all five principles...
</content>
</url_content>

<selected_text>
<title>SOLID Principles</title>
<path>solid/srp.md</path>
<start_line>10</start_line>
<end_line>11</end_line>
<content>
The Single Responsibility Principle states that a class should have only one reason to change.
</content>
</selected_text>`;

    messageRepository.addMessage(userMessage, processedText, USER_SENDER, context);

    const llmMessages = messageRepository.getLLMMessages();
    const message = llmMessages[0].message;

    // Verify all three context types are present with proper tags
    expect(message).toContain("<note_context>");
    expect(message).toContain("</note_context>");
    expect(message).toContain("<url_content>");
    expect(message).toContain("</url_content>");
    expect(message).toContain(`<${SELECTED_TEXT_TAG}>`);
    expect(message).toContain(`</${SELECTED_TEXT_TAG}>`);

    // Verify proper nesting and structure
    expect(message.indexOf("<note_context>")).toBeLessThan(message.indexOf("</note_context>"));
    expect(message.indexOf("<url_content>")).toBeLessThan(message.indexOf("</url_content>"));
    expect(message.indexOf(`<${SELECTED_TEXT_TAG}>`)).toBeLessThan(
      message.indexOf(`</${SELECTED_TEXT_TAG}>`)
    );
  });

  it("should handle error cases with proper XML tags", () => {
    const userMessage = "Process this file";
    const corruptedNote: TFile = {
      path: "corrupted-file.pdf",
      name: "corrupted-file.pdf",
      basename: "corrupted-file",
      extension: "pdf",
    } as TFile;

    const corruptedNoteReference = {
      file: corruptedNote,
    } as NoteReference;

    const context: MessageContext = {
      notes: [corruptedNoteReference],
      urls: [],
      selectedTextContexts: [],
    };

    const processedText = `Process this file

<note_context_error>
<title>corrupted-file</title>
<path>corrupted-file.pdf</path>
<error>[Error: Could not process file]</error>
</note_context_error>`;

    messageRepository.addMessage(userMessage, processedText, USER_SENDER, context);

    const llmMessages = messageRepository.getLLMMessages();
    expect(llmMessages[0].message).toContain("<note_context_error>");
    expect(llmMessages[0].message).toContain("<title>corrupted-file</title>");
    expect(llmMessages[0].message).toContain("<path>corrupted-file.pdf</path>");
    expect(llmMessages[0].message).toContain("<error>[Error: Could not process file]</error>");
    expect(llmMessages[0].message).toContain("</note_context_error>");
  });
});
