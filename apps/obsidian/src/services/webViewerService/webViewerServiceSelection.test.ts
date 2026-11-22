import { webSelectionReport } from "@/services/webViewerService/webViewerServiceSelection";

describe("webViewerServiceSelection", () => {
  describe("webSelectionReport()", () => {
    it("reports a web excerpt under its page, keyed by the page and the excerpt", () => {
      const context = {
        id: "web-1",
        content: "Quote",
        sourceType: "web" as const,
        title: "Page",
        url: "https://example.com/",
      };

      expect(webSelectionReport(context)).toEqual({
        location: "https://example.com/",
        key: "web:https://example.com/:Quote",
        context,
      });
    });
  });
});
