jest.mock("@/plusUtils", () => ({
  isSelfHostAccessValid: jest.fn(),
}));

import { getMiyoFolderName } from "@/miyo/miyoUtils";

describe("getMiyoFolderName", () => {
  it("uses the vault folder name even when an adapter exposes an absolute path", () => {
    const folderName = getMiyoFolderName({
      vault: {
        getName: () => "graham-essays-main",
        adapter: {
          getBasePath: () => "\\\\Mac\\Home\\Downloads\\graham-essays-main",
        },
      },
    } as any);

    expect(folderName).toBe("graham-essays-main");
  });
});
