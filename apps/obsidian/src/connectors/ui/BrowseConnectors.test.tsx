import { CONNECTOR_CATALOG, CONNECTOR_CATEGORIES } from "@/connectors/catalog";
import type {
  ConnectionState,
  ConnectorsSnapshot,
  WaitingLogin,
} from "@/connectors/connectionManager";
import { BrowseConnectors, type BrowseConnectorsProps } from "@/connectors/ui/BrowseConnectors";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

function snapshotOf(rest: Partial<ConnectorsSnapshot> = {}): ConnectorsSnapshot {
  return { connections: [], waitingLogin: null, failedLogin: null, needsAttention: false, ...rest };
}

function renderBrowse(snapshot: ConnectorsSnapshot = snapshotOf()) {
  const handlers = {
    onBack: jest.fn(),
    onAddCustom: jest.fn(),
    onConnect: jest.fn(),
    onReconnect: jest.fn(),
  };
  const props: BrowseConnectorsProps = { snapshot, ...handlers };
  render(<BrowseConnectors {...props} />);
  return handlers;
}

function rowNames(): string[] {
  return screen.getAllByRole("listitem").map((item) => item.getAttribute("aria-label") ?? "");
}

function row(name: string) {
  return within(screen.getByRole("listitem", { name }));
}

function categoryFilter(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Category" });
}

function filterBy(category: string): void {
  fireEvent.change(categoryFilter(), { target: { value: category } });
}

function search(query: string): void {
  fireEvent.change(
    screen.getByPlaceholderText("Search connectors, or what you want to do (tasks, meetings…)"),
    { target: { value: query } }
  );
}

const GRANOLA_WAITING: WaitingLogin = {
  connectionId: "new-1",
  serviceId: "granola",
  loginUrl: () => "https://granola.example/authorize",
  cancel: jest.fn(),
};

describe("BrowseConnectors", () => {
  describe("BrowseConnectors()", () => {
    it("lists every catalog service alphabetically with Connect in the scrolling results, and a way to request another below them", () => {
      renderBrowse();

      expect(screen.getByRole("heading", { name: "Browse connectors" })).toBeTruthy();
      const names = rowNames();
      expect(names).toHaveLength(CONNECTOR_CATALOG.length);
      expect(names).toEqual(
        [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      );
      expect(row("Notion").getByText("Pages and databases")).toBeTruthy();
      expect(row("Notion").getByRole("button", { name: "Connect" })).toBeTruthy();
      const request = screen.getByRole("link", { name: "Request a connector" });
      expect(new URL(request.getAttribute("href") ?? "").searchParams.get("title")).toBe(
        "Connector request: "
      );
      const results = screen.getByRole("region", { name: "Browse connectors" });
      expect(results.contains(screen.getByRole("listitem", { name: "Notion" }))).toBe(true);
      expect(results.contains(request)).toBe(false);
    });

    it("ends the list with a way to request a connector or add a custom one", () => {
      const { onAddCustom } = renderBrowse();

      expect(screen.getByText(/Don't see your service\?/).textContent).toBe(
        "Don't see your service? Request a connector or add a custom connector."
      );
      fireEvent.click(screen.getByRole("button", { name: "add a custom connector" }));
      expect(onAddCustom).toHaveBeenCalledTimes(1);
    });

    it("goes back to the connected list from Back", () => {
      const { onBack } = renderBrowse();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("offers All and then every category in the category filter, starting on All", () => {
      renderBrowse();

      expect(
        within(categoryFilter())
          .getAllByRole("option")
          .map((o) => o.textContent)
      ).toEqual(["All", ...CONNECTOR_CATEGORIES]);
      expect(categoryFilter().selectedOptions[0].textContent).toBe("All");
    });

    it("narrows the list to the chosen category, and All shows everything again", () => {
      renderBrowse();

      filterBy("Meetings");
      expect(rowNames()).toEqual(["Fireflies", "Granola"]);

      filterBy("");
      expect(rowNames()).toHaveLength(CONNECTOR_CATALOG.length);
    });

    it("searches the whole catalog with the category filter hidden, and restores the category when the search is cleared", () => {
      renderBrowse();
      filterBy("Design");

      search("meeting");
      expect(rowNames()).toEqual(["Fireflies", "Granola"]);
      expect(screen.queryByRole("combobox", { name: "Category" })).toBeNull();

      search("");
      expect(categoryFilter().value).toBe("Design");
      expect(rowNames()).not.toContain("Granola");
    });

    it("filters by name, description or category as the user types, and counts the matches", () => {
      renderBrowse();

      search("meeting");

      expect(rowNames()).toEqual(["Fireflies", "Granola"]);
      expect(screen.getByText("2 connectors match “meeting”")).toBeTruthy();
    });

    it("connects a service from its row", () => {
      const { onConnect } = renderBrowse();

      fireEvent.click(row("Notion").getByRole("button", { name: "Connect" }));

      expect(onConnect).toHaveBeenCalledWith("notion");
    });

    it("shows a connected service as connected, and offers Reconnect when it needs a login", () => {
      const connections: ConnectionState[] = [
        { id: "c1", serviceId: "granola", status: "connected" },
        { id: "c2", serviceId: "linear", status: "needs-login" },
      ];
      const { onReconnect } = renderBrowse(snapshotOf({ connections, needsAttention: true }));

      expect(row("Granola").getByText("Connected")).toBeTruthy();
      expect(row("Granola").queryByRole("button", { name: "Connect" })).toBeNull();
      expect(row("Linear").getByText("Needs login")).toBeTruthy();
      fireEvent.click(row("Linear").getByRole("button", { name: "Reconnect" }));
      expect(onReconnect).toHaveBeenCalledWith("c2");
    });

    it("shows the login waiting for the browser and disables every other Connect with the reason", () => {
      renderBrowse(snapshotOf({ waitingLogin: GRANOLA_WAITING }));

      expect(row("Granola").getByRole("status").textContent).toBe(
        "Waiting for you to log in in your browser…"
      );
      fireEvent.click(row("Granola").getByRole("button", { name: "Cancel" }));
      expect(GRANOLA_WAITING.cancel).toHaveBeenCalledTimes(1);

      const connect = row("Notion").getByRole("button", { name: "Connect" });
      expect(connect).toHaveProperty("disabled", true);
      expect(connect.parentElement?.getAttribute("title")).toBe(
        "Finish or cancel the Granola login first"
      );
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/858 keeps the waiting login and its Cancel pinned below the results when a search or category hides its service", () => {
      renderBrowse(snapshotOf({ waitingLogin: GRANOLA_WAITING }));

      search("linear");
      expect(rowNames()).toEqual(["Linear", "Granola"]);
      expect(screen.getByText("1 connector matches “linear”")).toBeTruthy();

      search("gmail");
      expect(rowNames()).toEqual(["Granola"]);
      expect(screen.getByRole("heading", { name: "No connector for “gmail” yet" })).toBeTruthy();
      fireEvent.click(row("Granola").getByRole("button", { name: "Cancel" }));
      expect(GRANOLA_WAITING.cancel).toHaveBeenCalled();

      search("");
      filterBy("Design");
      expect(rowNames().at(-1)).toBe("Granola");
    });

    it("shows why a new connection's login didn't finish, with Try again", () => {
      const { onConnect } = renderBrowse(
        snapshotOf({
          failedLogin: { connectionId: "new-1", serviceId: "notion", reason: "timed-out" },
        })
      );

      expect(
        row("Notion").getByText("The login timed out. Try again when you're ready.")
      ).toBeTruthy();
      fireEvent.click(row("Notion").getByRole("button", { name: "Try again" }));
      expect(onConnect).toHaveBeenCalledWith("notion");
    });

    it("retries a failed reconnect on the existing connection", () => {
      const { onReconnect, onConnect } = renderBrowse(
        snapshotOf({
          connections: [{ id: "c2", serviceId: "linear", status: "needs-login" }],
          failedLogin: { connectionId: "c2", serviceId: "linear", reason: "rejected" },
        })
      );

      expect(row("Linear").getByRole("link", { name: "Let us know" })).toBeTruthy();
      fireEvent.click(row("Linear").getByRole("button", { name: "Try again" }));
      expect(onReconnect).toHaveBeenCalledWith("c2");
      expect(onConnect).not.toHaveBeenCalled();
    });

    it("offers to request a service the catalog doesn't have", () => {
      renderBrowse();

      search("gmail");

      expect(screen.queryAllByRole("listitem")).toEqual([]);
      expect(screen.getByRole("heading", { name: "No connector for “gmail” yet" })).toBeTruthy();
      const request = screen.getByRole("link", { name: "Request Gmail" });
      expect(new URL(request.getAttribute("href") ?? "").searchParams.get("title")).toBe(
        "Connector request: Gmail"
      );
      expect(screen.queryByRole("link", { name: "Request a connector" })).toBeNull();
    });
  });
});
