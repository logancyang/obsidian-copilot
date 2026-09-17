import { AppContext, EventTargetContext, useApp } from "@/context";
import { render } from "@testing-library/react";
import type { App } from "obsidian";
import * as React from "react";
import { useChatInput } from "@/context/ChatInputContext";
import { GalleryChatInputProvider, GalleryProviders } from "@/components/gallery-hosts.fixtures";

interface ContextProbeProps {
  onRead: (app: App, eventTarget: EventTarget | undefined) => void;
}

function ContextProbe({ onRead }: ContextProbeProps): React.ReactElement {
  onRead(useApp(), React.useContext(EventTargetContext));
  return <div>Contexts available</div>;
}

function EditorProbe() {
  const { registerEditor } = useChatInput();
  return (
    <div>
      {typeof registerEditor === "function" ? "Editor context available" : "Missing editor"}
    </div>
  );
}

describe("GalleryProviders", () => {
  describe("GalleryChatInputProvider()", () => {
    it("provides editor registration to composer stories", () => {
      const view = render(
        <AppContext.Provider value={{} as App}>
          <GalleryChatInputProvider>
            <EditorProbe />
          </GalleryChatInputProvider>
        </AppContext.Provider>
      );
      expect(view.getByText("Editor context available")).toBeTruthy();
    });
  });
  describe("GalleryProviders()", () => {
    it("provides the current app and one stable event target across story rerenders", () => {
      const app = {} as App;
      const observations: Array<[App, EventTarget | undefined]> = [];
      const onRead = (observedApp: App, eventTarget: EventTarget | undefined) => {
        observations.push([observedApp, eventTarget]);
      };
      const providers = render(
        <AppContext.Provider value={app}>
          <GalleryProviders>
            <ContextProbe onRead={onRead} />
          </GalleryProviders>
        </AppContext.Provider>
      );

      providers.rerender(
        <AppContext.Provider value={app}>
          <GalleryProviders>
            <ContextProbe onRead={onRead} />
          </GalleryProviders>
        </AppContext.Provider>
      );

      expect(providers.getByText("Contexts available")).toBeTruthy();
      expect(observations).toHaveLength(2);
      expect(observations[0][0]).toBe(app);
      expect(observations[0][1]).toBeInstanceOf(EventTarget);
      expect(observations[1][1]).toBe(observations[0][1]);
    });
  });
});
