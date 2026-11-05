/**
 * @jest-environment node
 */
import { COPILOT_OAUTH_CLIENT_METADATA_URL } from "@/constants";
import {
  ConnectorAuth,
  loginFailureMessage,
  type ConnectorLogin,
  type LoginOutcome,
} from "@/connectors/oauth/connectorAuth";
import {
  FAKE_SERVER_URL,
  FakeOAuthService,
  type FakeOAuthServiceOptions,
} from "@/connectors/oauth/testing/fakeOAuthService";
import { get as httpGet } from "node:http";
import * as obsidian from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const setRequestUrlImpl = (obsidian as unknown as { __setRequestUrlImpl: (impl: unknown) => void })
  .__setRequestUrlImpl;

const VAULT_ID = "abcd1234";
const CONNECTION_ID = "conn-1";
const KEYCHAIN_ID = `copilot-v${VAULT_ID}-connector-${CONNECTION_ID}`;
const NOTION = { connectionId: CONNECTION_ID, serverUrl: FAKE_SERVER_URL, serviceName: "Notion" };
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

interface StoredLoginView {
  client: { client_id: string; client_secret?: string };
  tokens: { access_token: string; refresh_token?: string };
}

interface PageVisit {
  status: number;
  body: string;
}

function visit(url: string): Promise<PageVisit> {
  return new Promise((resolve, reject) => {
    httpGet(url, { agent: false }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

function fakeKeychain() {
  const secrets = new Map<string, string>();
  return {
    secrets,
    getVaultId: () => VAULT_ID,
    getSecretById: (id: string) => secrets.get(id) ?? null,
    setSecretById: (id: string, value: string) => void secrets.set(id, value),
    deleteSecretById: (id: string) => void secrets.delete(id),
  };
}

function fakeBrowser() {
  const opened: string[] = [];
  const waiters: Array<(url: string) => void> = [];
  return {
    opened,
    open: (url: string) => {
      opened.push(url);
      waiters.shift()?.(url);
    },
    nextUrl: () => new Promise<string>((resolve) => waiters.push(resolve)),
  };
}

const instances: ConnectorAuth[] = [];

function setUp(options: FakeOAuthServiceOptions = {}) {
  const service = new FakeOAuthService(options);
  setRequestUrlImpl(service.requestUrl);
  const keychain = fakeKeychain();
  const browser = fakeBrowser();
  const connectorAuth = new ConnectorAuth({ keychain, openUrl: browser.open });
  instances.push(connectorAuth);

  async function startLogin(): Promise<{ login: ConnectorLogin; authorizationUrl: URL }> {
    const opened = browser.nextUrl();
    const login = connectorAuth.login(NOTION);
    return { login, authorizationUrl: new URL(await opened) };
  }

  async function connect(): Promise<PageVisit> {
    const { login, authorizationUrl } = await startLogin();
    const page = await visit(service.approve(authorizationUrl.href));
    await expect(login.outcome).resolves.toEqual({ status: "connected" });
    return page;
  }

  function storedLogin(): StoredLoginView {
    return JSON.parse(keychain.secrets.get(KEYCHAIN_ID) ?? "null") as StoredLoginView;
  }

  return { service, keychain, browser, connectorAuth, startLogin, connect, storedLogin };
}

describe("connectorAuth", () => {
  afterEach(() => {
    for (const instance of instances.splice(0)) instance.activeLogin?.cancel();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("ConnectorAuth", () => {
    describe("login()", () => {
      it("opens the service's login page in the browser and connects once the user approves", async () => {
        const { service, startLogin } = setUp();

        const { login, authorizationUrl } = await startLogin();
        await visit(service.approve(authorizationUrl.href));

        expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
          "https://notion.fake/authorize"
        );
        expect(authorizationUrl.searchParams.get("redirect_uri")).toMatch(
          /^http:\/\/127\.0\.0\.1:\d+\/callback$/
        );
        expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
        await expect(login.outcome).resolves.toEqual({ status: "connected" });
      });

      it("stores the tokens and the client registration only in this connection's keychain entry", async () => {
        const { keychain, connect, storedLogin } = setUp();

        await connect();

        expect([...keychain.secrets.keys()]).toEqual([KEYCHAIN_ID]);
        const stored = storedLogin();
        expect(stored.client.client_id).toMatch(/^client-/);
        expect(stored.tokens.access_token).toMatch(/^access-/);
        expect(stored.tokens.refresh_token).toMatch(/^refresh-/);
      });

      it("shows '<Service> is connected to Copilot' in the browser after the login finishes", async () => {
        const { connect } = setUp();

        const page = await connect();

        expect(page.status).toBe(200);
        expect(page.body).toContain("Notion is connected to Copilot");
        expect(page.body).toContain("You can close this tab and go back to Obsidian.");
      });

      it("registers as 'Copilot for Obsidian' with its loopback callback when the service has no client metadata document support", async () => {
        const { service, startLogin } = setUp();

        const { authorizationUrl } = await startLogin();

        expect(service.registrations).toEqual([
          expect.objectContaining({
            client_name: "Copilot for Obsidian",
            redirect_uris: [authorizationUrl.searchParams.get("redirect_uri")],
          }),
        ]);
        expect(authorizationUrl.searchParams.get("client_id")).toMatch(/^client-/);
      });

      it("identifies itself with Copilot's client metadata document, without registering, when the service supports one", async () => {
        const { service, startLogin, storedLogin } = setUp({
          supportsClientMetadataDocuments: true,
        });

        const { login, authorizationUrl } = await startLogin();
        await visit(service.approve(authorizationUrl.href));
        await login.outcome;

        expect(authorizationUrl.searchParams.get("client_id")).toBe(
          COPILOT_OAUTH_CLIENT_METADATA_URL
        );
        expect(service.requestsTo("/register")).toEqual([]);
        expect(storedLogin()).toMatchObject({
          client: { client_id: COPILOT_OAUTH_CLIENT_METADATA_URL },
        });
      });

      it("keeps a client secret the service issues with the registration and authenticates the code exchange with it", async () => {
        const { service, connect, storedLogin } = setUp({ issuesClientSecret: true });

        await connect();

        expect(storedLogin().client.client_secret).toMatch(/^secret-/);
        expect(service.requestsTo("/token")[0].headers.authorization).toMatch(/^Basic /);
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/23 sends a state value and ignores a callback whose state does not match", async () => {
        const { service, startLogin } = setUp();
        const { login, authorizationUrl } = await startLogin();
        const callback = new URL(service.approve(authorizationUrl.href));
        const forged = new URL(callback.href);
        forged.searchParams.set("state", "forged");

        const forgedVisit = await visit(forged.href);
        await visit(callback.href);

        expect(authorizationUrl.searchParams.get("state")).toMatch(/.{16,}/);
        expect(forgedVisit.status).toBe(404);
        await expect(login.outcome).resolves.toEqual({ status: "connected" });
      });

      it("ends as cancelled-on-service and shows the didn't-finish page when the user denies the login on the service's page", async () => {
        const { service, keychain, startLogin } = setUp();
        const { login, authorizationUrl } = await startLogin();

        const page = await visit(service.deny(authorizationUrl.href));

        await expect(login.outcome).resolves.toEqual({
          status: "failed",
          reason: "cancelled-on-service",
        });
        expect(page.body).toContain("Notion login didn&#39;t finish");
        expect(page.body).toContain(
          "Login was cancelled on Notion&#39;s page. Go back to Obsidian and click Try again."
        );
        expect(keychain.secrets.size).toBe(0);
      });

      it("ends as rejected without opening the browser when the service refuses Copilot's registration", async () => {
        const { browser, connectorAuth } = setUp({ rejectsRegistration: true });

        const login = connectorAuth.login(NOTION);

        await expect(login.outcome).resolves.toEqual({ status: "failed", reason: "rejected" });
        expect(browser.opened).toEqual([]);
      });

      it("ends as unreachable when the service cannot be reached", async () => {
        const { service, connectorAuth } = setUp();
        service.unreachable = true;

        const login = connectorAuth.login(NOTION);

        await expect(login.outcome).resolves.toEqual({ status: "failed", reason: "unreachable" });
      });

      it("ends as timed-out after five minutes without an answer and stops listening for the callback", async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        const { startLogin } = setUp();
        const { login, authorizationUrl } = await startLogin();

        jest.advanceTimersByTime(FIVE_MINUTES_MS);

        await expect(login.outcome).resolves.toEqual({ status: "failed", reason: "timed-out" });
        await expect(
          visit(authorizationUrl.searchParams.get("redirect_uri") ?? "")
        ).rejects.toThrow(/ECONNREFUSED/);
      });

      it("ends as cancelled and stops listening for the callback when cancel() is called while waiting", async () => {
        const { service, startLogin, keychain } = setUp();
        const { login, authorizationUrl } = await startLogin();

        login.cancel();

        await expect(login.outcome).resolves.toEqual({ status: "cancelled" });
        await expect(visit(service.approve(authorizationUrl.href))).rejects.toThrow(/ECONNREFUSED/);
        expect(keychain.secrets.size).toBe(0);
      });

      it("stops listening for the callback once the login connects", async () => {
        const { service, startLogin } = setUp();
        const { login, authorizationUrl } = await startLogin();
        const callback = service.approve(authorizationUrl.href);
        await visit(callback);
        await login.outcome;

        await expect(visit(callback)).rejects.toThrow(/ECONNREFUSED/);
      });

      it("exposes the login URL while waiting so it can be copied or opened again", async () => {
        const { connectorAuth, startLogin } = setUp();

        const { login, authorizationUrl } = await startLogin();

        expect(login.loginUrl()).toBe(authorizationUrl.href);
        expect(connectorAuth.activeLogin).toBe(login);
      });

      it("refuses to start another login while one is waiting, and allows one after it ends", async () => {
        const { connectorAuth, startLogin } = setUp();
        const { login } = await startLogin();

        expect(() =>
          connectorAuth.login({ ...NOTION, connectionId: "conn-2", serviceName: "Linear" })
        ).toThrow("Finish or cancel the Notion login first");
        login.cancel();
        await login.outcome;

        expect(connectorAuth.activeLogin).toBeNull();
        expect(() => connectorAuth.login(NOTION).cancel()).not.toThrow();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/23 keeps the previous login when a new login does not finish", async () => {
        const { service, connect, startLogin, storedLogin } = setUp();
        await connect();
        const before = storedLogin();

        const { login, authorizationUrl } = await startLogin();
        await visit(service.deny(authorizationUrl.href));
        await login.outcome;

        expect(storedLogin()).toEqual(before);
      });
    });

    describe("accessToken()", () => {
      it("returns the stored access token while it has not expired, without contacting the service", async () => {
        const { service, connectorAuth, connect, storedLogin } = setUp();
        await connect();
        const requestsBefore = service.requests.length;

        const result = await connectorAuth.accessToken(CONNECTION_ID);

        expect(result).toEqual({
          status: "connected",
          accessToken: storedLogin().tokens.access_token,
        });
        expect(service.requests.length).toBe(requestsBefore);
      });

      it("silently refreshes an expired access token and stores the new tokens", async () => {
        const { service, connectorAuth, connect, storedLogin } = setUp();
        await connect();
        const firstTokens = storedLogin().tokens;
        jest.spyOn(Date, "now").mockReturnValue(Date.now() + TWO_HOURS_MS);

        const result = await connectorAuth.accessToken(CONNECTION_ID);

        const refreshed = storedLogin().tokens;
        expect(refreshed.access_token).not.toBe(firstTokens.access_token);
        expect(result).toEqual({ status: "connected", accessToken: refreshed.access_token });
        expect(service.requestsTo("/token")).toHaveLength(2);
      });

      it("refreshes an unexpired token when forceRefresh is set, as after the service answered 401", async () => {
        const { connectorAuth, connect, storedLogin } = setUp();
        await connect();
        const firstTokens = storedLogin().tokens;

        const result = await connectorAuth.accessToken(CONNECTION_ID, { forceRefresh: true });

        const refreshed = storedLogin().tokens;
        expect(refreshed.access_token).not.toBe(firstTokens.access_token);
        expect(result).toEqual({ status: "connected", accessToken: refreshed.access_token });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/23 shares one refresh between concurrent calls so a rotating refresh token is spent once", async () => {
        const { service, connectorAuth, connect } = setUp();
        await connect();

        const results = await Promise.all([
          connectorAuth.accessToken(CONNECTION_ID, { forceRefresh: true }),
          connectorAuth.accessToken(CONNECTION_ID, { forceRefresh: true }),
        ]);

        expect(results[0]).toEqual(results[1]);
        expect(results[0].status).toBe("connected");
        expect(service.requestsTo("/token")).toHaveLength(2);
      });

      it("returns needs-login and forgets the login when the service rejects the refresh token", async () => {
        const { service, keychain, connectorAuth, connect } = setUp();
        await connect();
        service.rejectRefreshTokens();

        const result = await connectorAuth.accessToken(CONNECTION_ID, { forceRefresh: true });

        expect(result).toEqual({ status: "needs-login" });
        expect(keychain.secrets.has(KEYCHAIN_ID)).toBe(false);
      });

      it("returns needs-login when this device has no login for the connection", async () => {
        const { connectorAuth } = setUp();

        await expect(connectorAuth.accessToken(CONNECTION_ID)).resolves.toEqual({
          status: "needs-login",
        });
      });

      it("returns unreachable and keeps the login when the service cannot be reached", async () => {
        const { service, connectorAuth, connect, storedLogin } = setUp();
        await connect();
        const before = storedLogin();
        service.unreachable = true;

        const result = await connectorAuth.accessToken(CONNECTION_ID, { forceRefresh: true });

        expect(result).toEqual({ status: "unreachable" });
        expect(storedLogin()).toEqual(before);
      });
    });

    describe("disconnect()", () => {
      it("revokes the refresh token at the service's revocation endpoint and deletes the keychain entry", async () => {
        const { service, keychain, connectorAuth, connect, storedLogin } = setUp({
          publishesRevocation: true,
        });
        await connect();
        const refreshToken = storedLogin().tokens.refresh_token;

        await connectorAuth.disconnect(CONNECTION_ID);

        expect(service.revokedTokens).toEqual([refreshToken]);
        expect(keychain.secrets.size).toBe(0);
      });

      it("deletes the keychain entry without a revocation call when the service publishes no revocation endpoint", async () => {
        const { service, keychain, connectorAuth, connect } = setUp();
        await connect();

        await connectorAuth.disconnect(CONNECTION_ID);

        expect(service.requestsTo("/revoke")).toEqual([]);
        expect(keychain.secrets.size).toBe(0);
      });

      it("deletes the keychain entry even when the service cannot be reached to revoke", async () => {
        const { service, keychain, connectorAuth, connect } = setUp({ publishesRevocation: true });
        await connect();
        service.unreachable = true;

        await connectorAuth.disconnect(CONNECTION_ID);

        expect(keychain.secrets.size).toBe(0);
      });
    });
  });

  describe("loginFailureMessage()", () => {
    it.each<[Extract<LoginOutcome, { status: "failed" }>["reason"], string]>([
      ["cancelled-on-service", "Login was cancelled on Notion's page."],
      ["timed-out", "The login timed out. Try again when you're ready."],
      ["rejected", "Notion didn't accept Copilot's login."],
      ["unreachable", "Couldn't reach Notion. Check your connection."],
    ])("states the %s reason as the connectors UI shows it", (reason, message) => {
      expect(loginFailureMessage(reason, "Notion")).toBe(message);
    });
  });
});
