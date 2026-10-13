import { AgentContextConversionModalContent } from "@/components/project/AgentContextConversionModalContent";
import type { ProcessingItem } from "@/components/project/processingAdapter";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const noop = () => {};

function renderContent(
  over: Partial<React.ComponentProps<typeof AgentContextConversionModalContent>>
) {
  return render(
    <AgentContextConversionModalContent
      items={[]}
      hasConfiguredContextSource
      skippedMarkdownCount={0}
      onRetryItem={noop}
      onRetryAll={noop}
      onEditContext={noop}
      {...over}
    />
  );
}

describe("AgentContextConversionModalContent", () => {
  describe("AgentContextConversionModalContent()", () => {
    it("reports no conversion needed for a configured project with no URL sources, as when its files are PDFs read in place", () => {
      renderContent({ items: [], hasConfiguredContextSource: true });

      expect(screen.getByText("No conversion needed")).toBeTruthy();
      expect(screen.queryByText(/failed/i)).toBeNull();
    });

    it("reports a whole-context failure with its error and a retry instead of no conversion needed https://github.com/Brevilabs/obsidian-copilot-private/issues/657", () => {
      const onRetryAll = jest.fn();
      renderContent({ items: [], contextFailure: "EACCES: cache folder", onRetryAll });

      expect(screen.getByText("Context failed to load")).toBeTruthy();
      expect(screen.getByText("EACCES: cache folder")).toBeTruthy();
      expect(screen.queryByText("No conversion needed")).toBeNull();
      fireEvent.click(screen.getByText("Retry"));
      expect(onRetryAll).toHaveBeenCalledTimes(1);
    });

    it("reports no context loaded when the project has no sources", () => {
      renderContent({ items: [], hasConfiguredContextSource: false });

      expect(screen.getByText("No context loaded")).toBeTruthy();
    });

    it("opens on the failed URL items under From URLs with the failed count in the header", () => {
      const items: ProcessingItem[] = [
        { id: "https://a.com", name: "a.com", cacheKind: "web", status: "ready" },
        { id: "https://b.com", name: "b.com", cacheKind: "web", status: "failed", error: "boom" },
      ];
      renderContent({ items });

      expect(screen.getByText("1 failed")).toBeTruthy();
      expect(screen.getByText("From URLs (1)")).toBeTruthy();
      expect(screen.getByText("https://b.com")).toBeTruthy();
    });
  });
});
