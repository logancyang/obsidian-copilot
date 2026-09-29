import { AI_SENDER, USER_SENDER } from "@/constants";
import { MessageContext } from "@/types/message";
import { TFile } from "obsidian";
import { MessageRepository } from "./MessageRepository";
import { mockTFile } from "@/__tests__/mockObsidian";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ debug: false })),
}));

describe("Message Lifecycle with Context Notes - Complete Example", () => {
  let messageRepository: MessageRepository;

  beforeEach(() => {
    messageRepository = new MessageRepository();
  });

  it("should demonstrate complete message lifecycle with context note", () => {
    const userDisplayText = "Please summarize the key points";
    const attachedNote: TFile = mockTFile({
      path: "meeting-notes-2024-01-15.md",
      name: "meeting-notes-2024-01-15.md",
      basename: "meeting-notes-2024-01-15",
      extension: "md",
    });

    const context: MessageContext = {
      notes: [attachedNote],
      urls: [],
      selectedTextContexts: [],
    };

    const messageId = messageRepository.addMessage(
      userDisplayText,
      userDisplayText,
      USER_SENDER,
      context
    );

    let displayMessages = messageRepository.getDisplayMessages();
    expect(displayMessages).toHaveLength(1);
    expect(displayMessages[0]).toMatchObject({
      message: "Please summarize the key points",
      sender: USER_SENDER,
      context: {
        notes: [
          expect.objectContaining({
            basename: "meeting-notes-2024-01-15",
          }),
        ],
      },
    });

    const processedTextWithContext = `Please summarize the key points

<note_context>
<title>meeting-notes-2024-01-15</title>
<path>meeting-notes-2024-01-15.md</path>
<ctime>2024-01-15T10:00:00.000Z</ctime>
<mtime>2024-01-15T14:30:00.000Z</mtime>
<content>
# Team Meeting - January 15, 2024

## Attendees
- John (Product Manager)
- Sarah (Tech Lead)
- Mike (Designer)

## Key Decisions
1. Launch date moved to Q2 2024
2. MVP features: Auth, Dashboard, Analytics
3. Tech stack: React + Node.js + PostgreSQL

## Action Items
- Sarah: Set up CI/CD pipeline by Jan 20
- Mike: Complete dashboard mockups by Jan 22
- John: Finalize user stories by Jan 18
</content>
</note_context>`;

    messageRepository.updateProcessedText(messageId, processedTextWithContext);

    displayMessages = messageRepository.getDisplayMessages();
    expect(displayMessages[0].message).toBe("Please summarize the key points");

    const llmMessages = messageRepository.getLLMMessages();
    expect(llmMessages[0].message).toBe("Please summarize the key points");
    expect(llmMessages[0].message).not.toContain("Team Meeting - January 15, 2024");

    const llmCurrentMessage = messageRepository.getLLMMessage(messageId);
    expect(llmCurrentMessage?.message).toBe(processedTextWithContext);
    expect(llmCurrentMessage?.message).toContain("Team Meeting - January 15, 2024");
    expect(llmCurrentMessage?.message).toContain("Launch date moved to Q2 2024");

    const aiResponse = `Based on the meeting notes, here are the key points:

**Main Decisions:**
• Project launch postponed to Q2 2024
• MVP will include authentication, dashboard, and analytics features
• Technology choices: React frontend, Node.js backend, PostgreSQL database

**Team Responsibilities:**
• Sarah (Tech Lead): CI/CD pipeline setup - Due Jan 20
• Mike (Designer): Dashboard mockup designs - Due Jan 22
• John (Product Manager): User story finalization - Due Jan 18

The team appears to be taking a pragmatic approach with a focused MVP scope and clear task delegation.`;

    messageRepository.addMessage(aiResponse, aiResponse, AI_SENDER);

    const finalDisplayMessages = messageRepository.getDisplayMessages();
    expect(finalDisplayMessages).toHaveLength(2);

    expect(finalDisplayMessages[0]).toMatchObject({
      message: "Please summarize the key points",
      sender: USER_SENDER,
      context: {
        notes: expect.arrayContaining([
          expect.objectContaining({ basename: "meeting-notes-2024-01-15" }),
        ]) as unknown,
      },
    });

    expect(finalDisplayMessages[1]).toMatchObject({
      message: expect.stringContaining("Based on the meeting notes") as unknown,
      sender: AI_SENDER,
    });

    const llmView = messageRepository.getLLMMessages();
    expect(llmView).toHaveLength(2);

    expect(llmView[0].message).toBe("Please summarize the key points");
    expect(llmView[0].message).not.toContain("Team Meeting - January 15, 2024");

    expect(llmView[1].message).toContain("Based on the meeting notes");

    expect(llmView[0].context).toBeDefined();
  });

  it("should handle message edit with context reprocessing", () => {
    const initialText = "List the attendees";
    const note: TFile = mockTFile({
      path: "meeting.md",
      name: "meeting.md",
      basename: "meeting",
      extension: "md",
    });

    const context: MessageContext = {
      notes: [note],
      urls: [],
      selectedTextContexts: [],
    };

    const messageId = messageRepository.addMessage(
      initialText,
      `${initialText}

<note_context>
<title>meeting</title>
<path>meeting.md</path>
<ctime>2024-01-10T09:00:00.000Z</ctime>
<mtime>2024-01-10T10:00:00.000Z</mtime>
<content>
Attendees: Alice, Bob, Charlie
</content>
</note_context>`,
      USER_SENDER,
      context
    );

    const editedText = "List the attendees and their roles";
    messageRepository.editMessage(messageId, editedText);

    const reprocessedText = `${editedText}

<note_context>
<title>meeting</title>
<path>meeting.md</path>
<ctime>2024-01-10T09:00:00.000Z</ctime>
<mtime>2024-01-10T10:30:00.000Z</mtime>
<content>
Attendees: Alice (PM), Bob (Dev), Charlie (QA)
</content>
</note_context>`;
    messageRepository.updateProcessedText(messageId, reprocessedText);

    const displayMessages = messageRepository.getDisplayMessages();
    expect(displayMessages[0].message).toBe("List the attendees and their roles");

    const llmMessages = messageRepository.getLLMMessages();
    expect(llmMessages[0].message).toBe("List the attendees and their roles");
    expect(llmMessages[0].message).not.toContain("Alice (PM), Bob (Dev), Charlie (QA)");

    const llmMessage = messageRepository.getLLMMessage(messageId);
    expect(llmMessage?.message).toContain("List the attendees and their roles");
    expect(llmMessage?.message).toContain("Alice (PM), Bob (Dev), Charlie (QA)");
  });

  it("should maintain context through conversation", () => {
    const context: MessageContext = {
      notes: [
        mockTFile({
          path: "budget.md",
          name: "budget.md",
          basename: "budget",
          extension: "md",
        }),
      ],
      urls: [],
      selectedTextContexts: [],
    };

    messageRepository.addMessage(
      "What is our total budget?",
      `What is our total budget?

<note_context>
<title>budget</title>
<path>budget.md</path>
<ctime>2024-01-01T08:00:00.000Z</ctime>
<mtime>2024-01-05T16:00:00.000Z</mtime>
<content>
Q1: $100k
Q2: $150k
Q3: $200k
Q4: $250k
</content>
</note_context>`,
      USER_SENDER,
      context
    );

    messageRepository.addMessage(
      "Based on the budget document, your total budget for the year is $700k ($100k + $150k + $200k + $250k).",
      "Based on the budget document, your total budget for the year is $700k ($100k + $150k + $200k + $250k).",
      AI_SENDER
    );

    messageRepository.addMessage(
      "What percentage increase is Q4 over Q1?",
      "What percentage increase is Q4 over Q1?",
      USER_SENDER
    );

    const messages = messageRepository.getDisplayMessages();
    expect(messages).toHaveLength(3);

    expect(messages[0].context?.notes).toHaveLength(1);

    expect(messages[1].context).toBeUndefined();
    expect(messages[2].context).toBeUndefined();

    const llmMessages = messageRepository.getLLMMessages();
    expect(llmMessages[0].message).not.toContain("<note_context>");
    expect(llmMessages[0].message).not.toContain("<title>budget</title>");

    const firstMessage = messageRepository.getLLMMessage(llmMessages[0].id!);
    expect(firstMessage?.message).toContain("<note_context>");
    expect(firstMessage?.message).toContain("<title>budget</title>");
  });
});
