import { Platform, type App, type EventRef, type Workspace } from "obsidian";
import {
  attachMobileNavbarBodyClass,
  MOBILE_NAVBAR_BODY_CLASS,
} from "./attachMobileNavbarBodyClass";

// The mapped obsidian mock exposes Platform as a mutable plain object, so tests
// flip the mobile flag directly on the same instance the helper reads.
const platform = Platform as { isMobile: boolean };

interface FakeWorkspace {
  on: jest.Mock;
  offref: jest.Mock;
  onLayoutReady: jest.Mock;
  containerEl: HTMLElement;
}

/**
 * Minimal app whose workspace records subscriptions and exposes the captured
 * layout-change / layout-ready callbacks so tests can fire them directly.
 */
function makeFakeApp(): {
  app: App;
  workspace: FakeWorkspace;
  fireLayoutChange: () => void;
  fireLayoutReady: () => void;
} {
  // jest.setup.js polyfills Obsidian's `Node.doc` augmentation, so this
  // element's `doc` resolves to the jsdom document like it would in-app.
  const containerEl = document.createElement("div");

  const layoutChangeCallbacks: Array<() => void> = [];
  const layoutReadyCallbacks: Array<() => void> = [];
  const workspace: FakeWorkspace = {
    on: jest.fn((name: string, callback: () => void): EventRef => {
      if (name === "layout-change") layoutChangeCallbacks.push(callback);
      return { callback };
    }),
    offref: jest.fn(),
    onLayoutReady: jest.fn((callback: () => void) => {
      layoutReadyCallbacks.push(callback);
    }),
    containerEl,
  };

  return {
    app: { workspace: workspace as unknown as Workspace } as App,
    workspace,
    fireLayoutChange: () => layoutChangeCallbacks.forEach((callback) => callback()),
    fireLayoutReady: () => layoutReadyCallbacks.forEach((callback) => callback()),
  };
}

function addNavbar(): HTMLElement {
  const navbar = document.createElement("div");
  navbar.className = "mobile-navbar";
  document.body.appendChild(navbar);
  return navbar;
}

describe("attachMobileNavbarBodyClass", () => {
  afterEach(() => {
    platform.isMobile = false;
    document.body.className = "";
    document.body.innerHTML = "";
  });

  describe("attachMobileNavbarBodyClass()", () => {
    it("does nothing on desktop: no subscription, no body class", () => {
      const { app, workspace } = makeFakeApp();
      addNavbar();

      const dispose = attachMobileNavbarBodyClass(app);

      expect(workspace.on).not.toHaveBeenCalled();
      expect(document.body.classList.contains(MOBILE_NAVBAR_BODY_CLASS)).toBe(false);
      expect(dispose).not.toThrow();
    });

    it("adds the body class immediately when a navbar already exists", () => {
      platform.isMobile = true;
      const { app } = makeFakeApp();
      addNavbar();

      attachMobileNavbarBodyClass(app);

      expect(document.body.classList.contains(MOBILE_NAVBAR_BODY_CLASS)).toBe(true);
    });

    it("leaves the body class off while no navbar exists", () => {
      platform.isMobile = true;
      const { app } = makeFakeApp();

      attachMobileNavbarBodyClass(app);

      expect(document.body.classList.contains(MOBILE_NAVBAR_BODY_CLASS)).toBe(false);
    });

    it("picks up a navbar created before the layout became ready", () => {
      platform.isMobile = true;
      const { app, fireLayoutReady } = makeFakeApp();

      attachMobileNavbarBodyClass(app);
      addNavbar();
      fireLayoutReady();

      expect(document.body.classList.contains(MOBILE_NAVBAR_BODY_CLASS)).toBe(true);
    });

    it("tracks navbar presence across layout changes in both directions", () => {
      platform.isMobile = true;
      const { app, fireLayoutChange } = makeFakeApp();

      attachMobileNavbarBodyClass(app);
      const navbar = addNavbar();
      fireLayoutChange();
      expect(document.body.classList.contains(MOBILE_NAVBAR_BODY_CLASS)).toBe(true);

      navbar.remove();
      fireLayoutChange();
      expect(document.body.classList.contains(MOBILE_NAVBAR_BODY_CLASS)).toBe(false);
    });

    it("dispose unsubscribes from layout-change and removes the body class", () => {
      platform.isMobile = true;
      const { app, workspace } = makeFakeApp();
      addNavbar();

      const dispose = attachMobileNavbarBodyClass(app);
      expect(document.body.classList.contains(MOBILE_NAVBAR_BODY_CLASS)).toBe(true);

      dispose();

      expect(workspace.offref).toHaveBeenCalledWith(workspace.on.mock.results[0].value);
      expect(document.body.classList.contains(MOBILE_NAVBAR_BODY_CLASS)).toBe(false);
    });
  });
});
