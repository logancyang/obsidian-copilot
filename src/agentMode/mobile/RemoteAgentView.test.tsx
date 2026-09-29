import { RemoteAgentView } from "@/agentMode/mobile/RemoteAgentView";
import { CHAT_AGENT_VIEWTYPE, COPILOT_AGENT_ICON_ID } from "@/constants";
import type CopilotPlugin from "@/main";
import { render, screen } from "@testing-library/react";
import type { App, WorkspaceLeaf } from "obsidian";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";

const mockMount = jest.fn();
const mockUnmount = jest.fn();
const mockDisposeObservers = jest.fn();
const mockRebindObserver = jest.fn();
const mockRegisterEvent = jest.fn();
let mockAppProps: Record<string, unknown> | null = null;

jest.mock("obsidian", () => ({
  ItemView: class {
    containerEl = document.createElement("div");
    app: unknown = null;
    registerEvent = mockRegisterEvent;
    constructor(readonly leaf: unknown) {}
  },
}));
jest.mock("@/utils/react/mountPluginViewRoot", () => ({
  mountPluginViewRoot: (...args: unknown[]) => {
    mockMount(...args);
    return { rerender: jest.fn(), unmount: mockUnmount };
  },
}));
jest.mock("@/components/chat-components/attachChatViewLayoutObservers", () => ({
  attachChatViewLayoutObservers: () => ({
    dispose: mockDisposeObservers,
    rebindDrawerObserver: mockRebindObserver,
  }),
}));
jest.mock("@/agentMode/mobile/RemoteAgentApp", () => ({
  RemoteAgentApp: (props: Record<string, unknown>) => {
    mockAppProps = props;
    return <div data-testid="remote-app" />;
  },
}));

function makeView(plugin: Partial<CopilotPlugin> = {}) {
  const layoutHandlers: Array<() => void> = [];
  const app = {
    name: "app",
    workspace: {
      on: jest.fn((_name: string, handler: () => void) => {
        layoutHandlers.push(handler);
        return { name: "layout-change-ref" };
      }),
    },
  } as unknown as App;
  const updateUserMessageHistory = jest.fn();
  const fullPlugin = {
    app,
    manifest: { version: "9.1.0" },
    remoteClient: { store: {} },
    updateUserMessageHistory,
    ...plugin,
  } as unknown as CopilotPlugin;
  const view = new RemoteAgentView({} as WorkspaceLeaf, fullPlugin);
  return { view, app, updateUserMessageHistory, plugin: fullPlugin, layoutHandlers };
}

async function openAndRender(view: RemoteAgentView) {
  await view.onOpen();
  const renderTree = mockMount.mock.calls[0][2] as () => React.ReactNode;
  return render(<>{renderTree()}</>);
}

describe("RemoteAgentView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppProps = null;
  });

  describe("RemoteAgentView", () => {
    describe("constructor()", () => {
      it("uses the plugin's app", () => {
        const { view, app } = makeView();

        expect(view.app).toBe(app);
      });
    });

    describe("getViewType()", () => {
      it(`takes the desktop agent view's type so a saved agent leaf reopens as this view on a phone (${ISSUE})`, () => {
        expect(makeView().view.getViewType()).toBe(CHAT_AGENT_VIEWTYPE);
      });
    });

    describe("getIcon()", () => {
      it("shows the agent chat icon", () => {
        expect(makeView().view.getIcon()).toBe(COPILOT_AGENT_ICON_ID);
      });
    });

    describe("getDisplayText()", () => {
      it("names the view Copilot Agent", () => {
        expect(makeView().view.getDisplayText()).toBe("Copilot Agent");
      });
    });

    describe("onOpen()", () => {
      it(`mounts the remote agent app with the plugin's remote client, app, version and message history (${ISSUE})`, async () => {
        const { view, app, plugin, updateUserMessageHistory } = makeView();

        await openAndRender(view);

        expect(mockMount).toHaveBeenCalledWith(view.containerEl, app, expect.any(Function));
        expect(screen.getByTestId("remote-app")).toBeTruthy();
        expect(mockAppProps).toMatchObject({
          app,
          remote: plugin.remoteClient,
          appVersion: "9.1.0",
        });
        (mockAppProps!.updateUserMessageHistory as (message: string) => void)("hello");
        expect(updateUserMessageHistory).toHaveBeenCalledWith("hello");
      });

      it(`follows the view into another drawer by rebinding the drawer observer on each layout change (${ISSUE})`, async () => {
        const { view, layoutHandlers } = makeView();
        jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
          callback(0);
          return 0;
        });

        await view.onOpen();

        expect(layoutHandlers).toHaveLength(1);
        expect(mockRegisterEvent).toHaveBeenCalledTimes(1);
        expect(mockRebindObserver).not.toHaveBeenCalled();
        layoutHandlers[0]();
        expect(mockRebindObserver).toHaveBeenCalledTimes(1);
      });

      it("renders nothing while the plugin has no remote client", async () => {
        const { view } = makeView({ remoteClient: undefined });

        await openAndRender(view);

        expect(screen.queryByTestId("remote-app")).toBeNull();
      });
    });

    describe("onClose()", () => {
      it("unmounts the React root, which disposes the phone's session link, and stops the layout observers", async () => {
        const { view } = makeView();
        await view.onOpen();

        await view.onClose();

        expect(mockUnmount).toHaveBeenCalledTimes(1);
        expect(mockDisposeObservers).toHaveBeenCalledTimes(1);
      });

      it("does nothing when the view was never opened or is closed twice", async () => {
        const { view } = makeView();
        await view.onClose();
        await view.onOpen();
        await view.onClose();
        await view.onClose();

        expect(mockUnmount).toHaveBeenCalledTimes(1);
        expect(mockDisposeObservers).toHaveBeenCalledTimes(1);
      });
    });
  });
});
