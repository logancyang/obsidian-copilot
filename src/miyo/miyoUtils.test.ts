jest.mock("@/plusUtils", () => ({
  isSelfHostAccessValid: jest.fn(),
}));

import { getMiyoFolderPath } from "@/miyo/miyoUtils";

describe("getMiyoFolderPath", () => {
  it("uses the vault folder name even when an adapter exposes an absolute path", () => {
    const folderPath = getMiyoFolderPath({
      vault: {
        getName: () => "graham-essays-main",
        adapter: {
          getBasePath: () => "\\\\Mac\\Home\\Downloads\\graham-essays-main",
        },
      },
    } as any);

    expect(folderPath).toBe("graham-essays-main");
  });
});
