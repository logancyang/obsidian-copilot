/**
 * @jest-environment node
 */
import type { ConnectorCatalogEntry } from "@/connectors/catalog";
import { ConnectionManager, type ConnectorAuthPort } from "@/connectors/connectionManager";
import type {
  AccessTokenResult,
  ConnectorLoginTarget,
  LoginOutcome,
} from "@/connectors/oauth/connectorAuth";
import { getSettings, setSettings } from "@/settings/model";

const NOTION: ConnectorCatalogEntry = {
  id: "notion",
  name: "Notion",
  description: "Pages and databases",
  category: "Notes & docs",
  serverUrl: "https://mcp.notion.com/mcp",
};
const LINEAR: ConnectorCatalogEntry = {
  id: "linear",
  name: "Linear",
  description: "Issues and projects",
  category: "Tasks & projects",
  serverUrl: "https://mcp.linear.app/mcp",
};
const LOGIN_URL = "https://notion.example/authorize?state=1";

interface PendingLogin {
  target: ConnectorLoginTarget;
  finish: (outcome: LoginOutcome) => void;
}

function fakeAuth() {
  const logins = new Set<string>();
  const nextAccess = new Map<string, AccessTokenResult>();
  let pending: PendingLogin | null = null;
  const auth = {
    hasLogin: (connectionId: string) => logins.has(connectionId),
    login: jest.fn((target: ConnectorLoginTarget) => {
      if (pending) throw new Error("Finish or cancel the login first.");
      let finish: (outcome: LoginOutcome) => void = () => {};
      const outcome = new Promise<LoginOutcome>((resolve) => {
        finish = (result) => {
          pending = null;
          if (result.status === "connected") logins.add(target.connectionId);
          resolve(result);
        };
      });
      pending = { target, finish };
      return {
        connectionId: target.connectionId,
        serviceName: target.serviceName,
        outcome,
        loginUrl: () => LOGIN_URL,
        cancel: () => finish({ status: "cancelled" }),
      };
    }),
    accessToken: jest.fn(
      async (connectionId: string, _options?: { forceRefresh?: boolean }) =>
        nextAccess.get(connectionId) ??
        (logins.has(connectionId)
          ? ({ status: "connected", accessToken: `token-${connectionId}` } as const)
          : ({ status: "needs-login" } as const))
    ),
    disconnect: jest.fn(async (connectionId: string) => {
      logins.delete(connectionId);
    }),
  } satisfies ConnectorAuthPort;
  return {
    auth,
    logins,
    nextAccess,
    pendingLogin: () => pending,
    finishLogin: (outcome: LoginOutcome) => pending?.finish(outcome),
  };
}

const managers: ConnectionManager[] = [];

function setUp(options: { connections?: Array<{ id: string; serviceId: string }> } = {}) {
  setSettings({ connectors: options.connections ?? [] });
  const fake = fakeAuth();
  const manager = new ConnectionManager({ auth: fake.auth, catalog: [NOTION, LINEAR] });
  managers.push(manager);
  return { ...fake, manager };
}

function statusOf(manager: ConnectionManager, connectionId: string) {
  return manager.getSnapshot().connections.find((c) => c.id === connectionId)?.status;
}

async function connectNotion(fake: ReturnType<typeof setUp>) {
  const outcome = fake.manager.connect("notion");
  fake.finishLogin({ status: "connected" });
  await outcome;
  return getSettings().connectors[0].id;
}

describe("connectionManager", () => {
  afterEach(() => {
    managers.splice(0).forEach((manager) => manager.dispose());
  });

  describe("ConnectionManager", () => {
    describe("getSnapshot()", () => {
      it("lists no connections for settings written before connectors existed", () => {
        const { manager } = setUp();

        expect(manager.getSnapshot()).toEqual({
          connections: [],
          waitingLogin: null,
          failedLogin: null,
          needsAttention: false,
        });
      });

      it("shows a stored connection as connected when this device's keychain holds its login", () => {
        setSettings({ connectors: [{ id: "c1", serviceId: "notion" }] });
        const fake = fakeAuth();
        fake.logins.add("c1");
        const manager = new ConnectionManager({ auth: fake.auth, catalog: [NOTION] });
        managers.push(manager);

        expect(manager.getSnapshot().connections).toEqual([
          { id: "c1", serviceId: "notion", status: "connected" },
        ]);
      });

      it("shows a connection synced from another device as needs login when this device has no login for it", () => {
        const { manager } = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });

        expect(statusOf(manager, "c1")).toBe("needs-login");
        expect(manager.getSnapshot().needsAttention).toBe(true);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/856 leaves out a stored connection whose service this version's catalog does not list", () => {
        const { manager } = setUp({ connections: [{ id: "c1", serviceId: "retired" }] });

        expect(manager.getSnapshot().connections).toEqual([]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/862 needs attention while a custom connector does, and tells subscribers when that changes", () => {
        setSettings({ connectors: [] });
        let customSnapshot = { connectors: [], needsAttention: false };
        const customListeners = new Set<() => void>();
        const manager = new ConnectionManager({
          auth: fakeAuth().auth,
          catalog: [NOTION],
          custom: {
            subscribe: (listener) => {
              customListeners.add(listener);
              return () => customListeners.delete(listener);
            },
            getSnapshot: () => customSnapshot,
          },
        });
        managers.push(manager);
        const listener = jest.fn();
        manager.subscribe(listener);
        expect(manager.getSnapshot().needsAttention).toBe(false);

        customSnapshot = { connectors: [], needsAttention: true };
        customListeners.forEach((notify) => notify());

        expect(manager.getSnapshot().needsAttention).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("returns the same snapshot until something changes, so React does not re-render", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        fake.logins.add("c1");
        await fake.manager.accessToken("c1");
        const first = fake.manager.getSnapshot();

        await fake.manager.accessToken("c1");
        setSettings({ debug: !getSettings().debug });

        expect(fake.manager.getSnapshot()).toBe(first);
      });
    });

    describe("subscribe()", () => {
      it("notifies on each change and stops after unsubscribing", async () => {
        const fake = setUp();
        const listener = jest.fn();
        const unsubscribe = fake.manager.subscribe(listener);

        const outcome = fake.manager.connect("notion");
        expect(listener).toHaveBeenCalled();
        unsubscribe();
        listener.mockClear();
        fake.finishLogin({ status: "connected" });
        await outcome;

        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe("connect()", () => {
      it("waits for the browser with the login link and a cancel, without adding a connection yet", () => {
        const fake = setUp();

        void fake.manager.connect("notion");

        const { waitingLogin, connections } = fake.manager.getSnapshot();
        expect(waitingLogin).toMatchObject({ serviceId: "notion" });
        expect(waitingLogin?.loginUrl()).toBe(LOGIN_URL);
        expect(connections).toEqual([]);
        expect(getSettings().connectors).toEqual([]);
        expect(fake.pendingLogin()?.target).toEqual({
          connectionId: waitingLogin?.connectionId,
          serverUrl: NOTION.serverUrl,
          serviceName: "Notion",
        });
      });

      it("generates a lowercase connection id of at most 36 characters, as the keychain id requires", () => {
        const fake = setUp();

        void fake.manager.connect("notion");

        expect(fake.manager.getSnapshot().waitingLogin?.connectionId).toMatch(/^[a-z0-9-]{1,36}$/);
      });

      it("adds the connection to the synced list as connected once the login finishes", async () => {
        const fake = setUp();

        const outcome = fake.manager.connect("notion");
        const connectionId = fake.manager.getSnapshot().waitingLogin?.connectionId;
        fake.finishLogin({ status: "connected" });

        await expect(outcome).resolves.toEqual({ status: "connected" });
        expect(getSettings().connectors).toEqual([{ id: connectionId, serviceId: "notion" }]);
        expect(fake.manager.getSnapshot()).toMatchObject({
          connections: [{ id: connectionId, serviceId: "notion", status: "connected" }],
          waitingLogin: null,
        });
      });

      it("adds nothing and shows no failure when the user cancels the login", async () => {
        const fake = setUp();

        const outcome = fake.manager.connect("notion");
        fake.manager.getSnapshot().waitingLogin?.cancel();

        await expect(outcome).resolves.toEqual({ status: "cancelled" });
        expect(getSettings().connectors).toEqual([]);
        expect(fake.manager.getSnapshot()).toMatchObject({ waitingLogin: null, failedLogin: null });
      });

      it("reports why a login didn't finish for the service, and clears it on the next attempt", async () => {
        const fake = setUp();

        const outcome = fake.manager.connect("notion");
        const connectionId = fake.manager.getSnapshot().waitingLogin?.connectionId;
        fake.finishLogin({ status: "failed", reason: "timed-out" });
        await outcome;

        expect(getSettings().connectors).toEqual([]);
        expect(fake.manager.getSnapshot().failedLogin).toEqual({
          connectionId,
          serviceId: "notion",
          reason: "timed-out",
        });

        void fake.manager.connect("notion");

        expect(fake.manager.getSnapshot().failedLogin).toBeNull();
      });

      it("throws for a service the catalog does not list", () => {
        const { manager } = setUp();

        expect(() => manager.connect("unknown")).toThrow("unknown");
      });
    });

    describe("reconnect()", () => {
      it("moves a needs-login connection back to connected once the login finishes, keeping its id", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        expect(statusOf(fake.manager, "c1")).toBe("needs-login");

        const outcome = fake.manager.reconnect("c1");
        expect(fake.manager.getSnapshot().waitingLogin?.connectionId).toBe("c1");
        expect(fake.manager.getSnapshot().needsAttention).toBe(true);
        fake.finishLogin({ status: "connected" });
        await outcome;

        expect(getSettings().connectors).toEqual([{ id: "c1", serviceId: "notion" }]);
        expect(statusOf(fake.manager, "c1")).toBe("connected");
        expect(fake.manager.getSnapshot().needsAttention).toBe(false);
      });

      it("moves a connection that refresh failed on back to connected after a reconnect", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        fake.logins.add("c1");
        fake.nextAccess.set("c1", { status: "needs-login" });
        await fake.manager.accessToken("c1", { forceRefresh: true });
        expect(statusOf(fake.manager, "c1")).toBe("needs-login");

        fake.nextAccess.delete("c1");
        const outcome = fake.manager.reconnect("c1");
        fake.finishLogin({ status: "connected" });
        await outcome;

        expect(statusOf(fake.manager, "c1")).toBe("connected");
      });

      it("keeps the connection's status and reports the reason when the reconnect login fails", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });

        const outcome = fake.manager.reconnect("c1");
        fake.finishLogin({ status: "failed", reason: "rejected" });
        await outcome;

        expect(statusOf(fake.manager, "c1")).toBe("needs-login");
        expect(fake.manager.getSnapshot().failedLogin).toEqual({
          connectionId: "c1",
          serviceId: "notion",
          reason: "rejected",
        });
      });
    });

    describe("accessToken()", () => {
      it("returns the token and keeps the connection connected", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        fake.logins.add("c1");

        await expect(fake.manager.accessToken("c1")).resolves.toEqual({
          status: "connected",
          accessToken: "token-c1",
        });
        expect(statusOf(fake.manager, "c1")).toBe("connected");
      });

      it("passes forceRefresh through, as after the service answered 401", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });

        await fake.manager.accessToken("c1", { forceRefresh: true });

        expect(fake.auth.accessToken).toHaveBeenCalledWith("c1", { forceRefresh: true });
      });

      it("moves the connection to needs login when the refresh is rejected", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        fake.logins.add("c1");
        fake.nextAccess.set("c1", { status: "needs-login" });
        const listener = jest.fn();
        fake.manager.subscribe(listener);

        await fake.manager.accessToken("c1", { forceRefresh: true });

        expect(statusOf(fake.manager, "c1")).toBe("needs-login");
        expect(fake.manager.getSnapshot().needsAttention).toBe(true);
        expect(listener).toHaveBeenCalled();
      });

      it("moves the connection to couldn't reach, which needs no attention, when the service is unreachable", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        fake.logins.add("c1");
        fake.nextAccess.set("c1", { status: "unreachable" });

        await fake.manager.accessToken("c1");

        expect(statusOf(fake.manager, "c1")).toBe("unreachable");
        expect(fake.manager.getSnapshot().needsAttention).toBe(false);
      });

      it("moves a couldn't-reach connection back to connected when the next try gets a token", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        fake.logins.add("c1");
        fake.nextAccess.set("c1", { status: "unreachable" });
        await fake.manager.accessToken("c1");

        fake.nextAccess.delete("c1");
        await fake.manager.accessToken("c1");

        expect(statusOf(fake.manager, "c1")).toBe("connected");
      });
    });

    describe("reportFailure()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/857 moves a connected service to couldn't reach or needs login when a tool call fails, and tells subscribers", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        fake.logins.add("c1");
        await fake.manager.accessToken("c1");
        const listener = jest.fn();
        fake.manager.subscribe(listener);

        fake.manager.reportFailure("c1", "unreachable");
        expect(statusOf(fake.manager, "c1")).toBe("unreachable");
        fake.manager.reportFailure("c1", "needs-login");

        expect(statusOf(fake.manager, "c1")).toBe("needs-login");
        expect(fake.manager.getSnapshot().needsAttention).toBe(true);
        expect(listener).toHaveBeenCalledTimes(2);
      });

      it("leaves the snapshot alone when the connection already has that status", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        await fake.manager.accessToken("c1");
        const before = fake.manager.getSnapshot();

        fake.manager.reportFailure("c1", "needs-login");

        expect(fake.manager.getSnapshot()).toBe(before);
      });
    });

    describe("checkStatus()", () => {
      it("checks every connection's login, as on Obsidian start and when a chat starts", async () => {
        const fake = setUp({
          connections: [
            { id: "c1", serviceId: "notion" },
            { id: "c2", serviceId: "linear" },
          ],
        });
        fake.logins.add("c1").add("c2");
        fake.nextAccess.set("c2", { status: "needs-login" });

        await fake.manager.checkStatus();

        expect(fake.auth.accessToken).toHaveBeenCalledTimes(2);
        expect(fake.manager.getSnapshot().connections.map((c) => c.status)).toEqual([
          "connected",
          "needs-login",
        ]);
      });
    });

    describe("disconnect()", () => {
      it("deletes the login and removes the connection from the synced list in one step", async () => {
        const fake = setUp();
        const connectionId = await connectNotion(fake);

        await fake.manager.disconnect(connectionId);

        expect(fake.auth.disconnect).toHaveBeenCalledWith(connectionId);
        expect(fake.logins.has(connectionId)).toBe(false);
        expect(getSettings().connectors).toEqual([]);
        expect(fake.manager.getSnapshot().connections).toEqual([]);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/856 cancels a reconnect login waiting for the same connection", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        const outcome = fake.manager.reconnect("c1");

        await fake.manager.disconnect("c1");

        await expect(outcome).resolves.toEqual({ status: "cancelled" });
        expect(fake.manager.getSnapshot().waitingLogin).toBeNull();
        expect(getSettings().connectors).toEqual([]);
      });

      it("clears attention when the connection that needed a login is disconnected", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        expect(fake.manager.getSnapshot().needsAttention).toBe(true);

        await fake.manager.disconnect("c1");

        expect(fake.manager.getSnapshot().needsAttention).toBe(false);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/856 refuses a reconnect started while the connection's login is being revoked", async () => {
        const fake = setUp({ connections: [{ id: "c1", serviceId: "notion" }] });
        let finishRevocation: () => void = () => {};
        fake.auth.disconnect.mockImplementationOnce(
          () => new Promise<void>((resolve) => (finishRevocation = resolve))
        );

        const disconnecting = fake.manager.disconnect("c1");
        expect(() => fake.manager.reconnect("c1")).toThrow("No connection c1.");
        finishRevocation();
        await disconnecting;

        expect(fake.auth.login).not.toHaveBeenCalled();
        expect(getSettings().connectors).toEqual([]);
      });
    });

    describe("dismissFailedLogin()", () => {
      it("clears the reason a login didn't finish once the user leaves the page that showed it", async () => {
        const fake = setUp();
        const outcome = fake.manager.connect("notion");
        fake.finishLogin({ status: "failed", reason: "timed-out" });
        await outcome;
        const listener = jest.fn();
        fake.manager.subscribe(listener);

        fake.manager.dismissFailedLogin();

        expect(fake.manager.getSnapshot().failedLogin).toBeNull();
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("leaves the snapshot untouched when no login failed", () => {
        const fake = setUp();
        const before = fake.manager.getSnapshot();
        const listener = jest.fn();
        fake.manager.subscribe(listener);

        fake.manager.dismissFailedLogin();

        expect(fake.manager.getSnapshot()).toBe(before);
        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe("dispose()", () => {
      it("cancels a waiting login and stops notifying subscribers", async () => {
        const fake = setUp();
        const outcome = fake.manager.connect("notion");
        const listener = jest.fn();
        fake.manager.subscribe(listener);

        fake.manager.dispose();
        listener.mockClear();

        await expect(outcome).resolves.toEqual({ status: "cancelled" });
        expect(listener).not.toHaveBeenCalled();
        expect(getSettings().connectors).toEqual([]);
      });
    });
  });
});
