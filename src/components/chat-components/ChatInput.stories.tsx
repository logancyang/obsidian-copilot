import React from "react";
import ChatInput, { type ChatInputHandle } from "./ChatInput";
import { GalleryChatInputProvider } from "@/components/gallery-hosts.fixtures";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import type { Meta, StoryObj } from "@/lib/story";
import { TFile } from "obsidian";

const noteFixture: unknown = Object.create(TFile.prototype);
if (!(noteFixture instanceof TFile)) throw new Error("Expected a TFile fixture");
const note = Object.assign(noteFixture, {
  path: "Research notes.md",
  basename: "Research notes",
  extension: "md",
});
const screenshot = new File(
  [
    new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0,
      0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 3, 3, 2, 0,
      239, 154, 51, 91, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]),
  ],
  "queued-image-1.png",
  { type: "image/png" }
);

function RestoredComposer() {
  const app = useApp();
  const ref = React.useRef<ChatInputHandle>(null);
  const [input, setInput] = React.useState("Also compare the conclusions.");
  const [notes, setNotes] = React.useState<TFile[]>([]);
  const [images, setImages] = React.useState<File[]>([]);
  const [stopped, setStopped] = React.useState(false);
  return (
    <GalleryChatInputProvider>
      <Button
        disabled={stopped}
        onClick={() => {
          ref.current?.prependContent(
            "Summarize the findings.\n\nReview the supporting evidence.",
            ["claude"],
            [{ url: "https://example.com/report", title: "Research report" }]
          );
          setNotes([note]);
          setImages([screenshot]);
          setStopped(true);
        }}
      >
        Stop and restore queued follow-ups
      </Button>
      <ChatInput
        ref={ref}
        app={app}
        isAgentMode
        inputMessage={input}
        setInputMessage={setInput}
        contextNotes={notes}
        setContextNotes={setNotes}
        selectedImages={images}
        setSelectedImages={setImages}
        onAddImage={(files) => setImages((previous) => [...previous, ...files])}
        includeActiveNote={false}
        setIncludeActiveNote={() => undefined}
        activeWebTab={null}
        includeActiveWebTab={false}
        setIncludeActiveWebTab={() => undefined}
        handleSendMessage={() => undefined}
        onStopGenerating={() => undefined}
        isGenerating={false}
        disableModelSwitch
      />
    </GalleryChatInputProvider>
  );
}
const meta = {
  title: "Chat/Restored Composer",
  component: RestoredComposer,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta;
export default meta;
export const StoppedQueue: StoryObj = {};
