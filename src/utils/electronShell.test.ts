import { getElectronShell, openLinkInSystemBrowser } from "./electronShell";

const openExternal = jest.fn<Promise<void>, [string]>();
jest.mock("electron", () => ({ shell: { openExternal } }), { virtual: true });

function linkClick(href: string) {
  return { preventDefault: jest.fn(), currentTarget: { href } };
}

describe("electronShell", () => {
  beforeEach(() => {
    openExternal.mockReset().mockResolvedValue(undefined);
  });

  describe("getElectronShell()", () => {
    it("returns Electron's shell when the desktop runtime provides it", () => {
      expect(getElectronShell()?.openExternal).toBe(openExternal);
    });
  });

  describe("openLinkInSystemBrowser()", () => {
    it("https://github.com/logancyang/obsidian-copilot/issues/3985 opens the link in the system browser instead of letting Obsidian route it to the Web Viewer", () => {
      const click = linkClick("https://claude.com/cai/oauth/authorize?code=true");

      openLinkInSystemBrowser(click);

      expect(openExternal).toHaveBeenCalledWith("https://claude.com/cai/oauth/authorize?code=true");
      expect(click.preventDefault).toHaveBeenCalledTimes(1);
    });
  });
});
