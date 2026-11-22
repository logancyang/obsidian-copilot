import { useObjectUrl } from "@/hooks/useObjectUrl";
import { renderHook } from "@testing-library/react";

describe("useObjectUrl", () => {
  describe("useObjectUrl()", () => {
    const { createObjectURL, revokeObjectURL } = URL;
    let created: string[];

    beforeEach(() => {
      created = [];
      URL.createObjectURL = jest.fn(() => {
        const url = `blob:test-${created.length}`;
        created.push(url);
        return url;
      });
      URL.revokeObjectURL = jest.fn();
    });

    afterAll(() => {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    });

    it("keeps one URL for a blob across re-renders so typing does not re-decode attached images https://github.com/Brevilabs/obsidian-copilot-private/issues/666", () => {
      const photo = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
      const { result, rerender } = renderHook(({ blob }) => useObjectUrl(blob), {
        initialProps: { blob: photo },
      });

      rerender({ blob: photo });
      rerender({ blob: photo });

      expect(result.current).toBe("blob:test-0");
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it("revokes the previous URL when the blob changes and the last URL on unmount https://github.com/Brevilabs/obsidian-copilot-private/issues/666", () => {
      const first = new File(["first"], "first.png", { type: "image/png" });
      const second = new File(["second"], "second.png", { type: "image/png" });
      const { result, rerender, unmount } = renderHook(({ blob }) => useObjectUrl(blob), {
        initialProps: { blob: first },
      });

      rerender({ blob: second });
      expect(result.current).toBe("blob:test-1");
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-0");

      unmount();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-1");
    });
  });
});
