/**
 * @jest-environment node
 */
import {
  CopilotAccount,
  type AccountProfile,
  type CopilotAccountState,
} from "@/copilotAccount/copilotAccount";
import { ConnectorAuth } from "@/connectors/oauth/connectorAuth";
import { FAKE_SERVICE_ORIGIN, FakeOAuthService } from "@/connectors/oauth/testing/fakeOAuthService";
import { get as httpGet } from "node:http";
import * as obsidian from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const setRequestUrlImpl = (obsidian as unknown as { __setRequestUrlImpl: (impl: unknown) => void })
  .__setRequestUrlImpl;

const VAULT_ID = "abcd1234";
const LOGIN_KEYCHAIN_ID = `copilot-v${VAULT_ID}-connector-copilot-account`;
const INSTALL_ID = "0b7f1c5e-3f7a-4c2e-9d4b-1a2b3c4d5e6f";
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const FREE_PROFILE: AccountProfile = {
  email: "you@example.com",
  name: "Your Name",
  plan: "free",
};

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
      response.on("end", () =>
        resolve({ status: response.statusCode ?? 0, body: body.replace(/&#39;/g, "'") })
      );
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

const accounts: CopilotAccount[] = [];

function setUp({ installId = () => INSTALL_ID }: { installId?: () => string } = {}) {
  const service = new FakeOAuthService({
    supportsClientMetadataDocuments: true,
    publishesRevocation: true,
  });
  setRequestUrlImpl(service.requestUrl);
  const keychain = fakeKeychain();
  const browser = fakeBrowser();

  function createAccount(): CopilotAccount {
    const account = new CopilotAccount({
      auth: new ConnectorAuth({ keychain, openUrl: browser.open }),
      websiteOrigin: FAKE_SERVICE_ORIGIN,
      installId,
      openUrl: browser.open,
    });
    accounts.push(account);
    return account;
  }

  const account = createAccount();

  async function startSignIn(): Promise<{ signingIn: Promise<void>; signInUrl: URL }> {
    const opened = browser.nextUrl();
    const signingIn = account.signIn();
    return { signingIn, signInUrl: new URL(await opened) };
  }

  async function signIn(): Promise<PageVisit> {
    const { signingIn, signInUrl } = await startSignIn();
    const page = await visit(service.approve(signInUrl.href));
    await signingIn;
    return page;
  }

  return { service, keychain, browser, account, createAccount, startSignIn, signIn };
}

function signedIn(profile: AccountProfile | null): CopilotAccountState {
  return { status: "signed-in", profile };
}

describe("copilotAccount", () => {
  afterEach(() => {
    for (const account of accounts.splice(0)) account.dispose();
    jest.useRealTimers();
  });

  describe("CopilotAccount", () => {
    describe("getSnapshot()", () => {
      it("starts signed out on a device that has no login", () => {
        const { account } = setUp();

        expect(account.getSnapshot()).toEqual({ status: "signed-out", failure: null });
      });

      it("starts signed in, before reading the account, when this device kept a login from an earlier run", async () => {
        const { signIn, createAccount } = setUp();
        await signIn();

        const afterRestart = createAccount();

        expect(afterRestart.getSnapshot()).toEqual(signedIn(null));
      });
    });

    describe("subscribe()", () => {
      it("notifies each subscriber when the state changes until it unsubscribes", async () => {
        const { account, startSignIn } = setUp();
        const seen: string[] = [];
        const unsubscribe = account.subscribe(() => seen.push(account.getSnapshot().status));

        const { signingIn } = await startSignIn();
        unsubscribe();
        account.cancelSignIn();
        await signingIn;

        expect(seen).toEqual(["signing-in"]);
      });
    });

    describe("signIn()", () => {
      it("opens the website's sign-in page and shows the account's email and plan once the user finishes signing in", async () => {
        const { service, account, startSignIn } = setUp();

        const { signingIn, signInUrl } = await startSignIn();
        expect(account.getSnapshot()).toEqual({ status: "signing-in" });
        await visit(service.approve(signInUrl.href));
        await signingIn;

        expect(signInUrl.origin + signInUrl.pathname).toBe(`${FAKE_SERVICE_ORIGIN}/authorize`);
        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
      });

      it("tells the website which install is signing in — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", async () => {
        const { startSignIn } = setUp();

        const { signInUrl } = await startSignIn();

        expect(signInUrl.searchParams.get("install_id")).toBe(INSTALL_ID);
      });

      it("signs in without an install id when this device has no saved id — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", async () => {
        const { account, service, startSignIn } = setUp({
          installId: () => {
            throw new Error("A persisted UUIDv4 device identifier is required.");
          },
        });

        const { signingIn, signInUrl } = await startSignIn();
        await visit(service.approve(signInUrl.href));
        await signingIn;

        expect(signInUrl.searchParams.has("install_id")).toBe(false);
        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
      });

      it("keeps the login in this vault's keychain entry", async () => {
        const { keychain, signIn } = setUp();

        await signIn();

        expect([...keychain.secrets.keys()]).toEqual([LOGIN_KEYCHAIN_ID]);
      });

      it("tells the browser the user is signed in to Copilot, not that a service is connected — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", async () => {
        const { signIn } = setUp();

        const page = await signIn();

        expect(page.body).toContain("You're signed in to Copilot");
        expect(page.body).toContain("You can close this tab and go back to Obsidian.");
        expect(page.body).not.toContain("is connected to Copilot");
      });

      it("says the sign-in timed out and stores no login when the browser never comes back", async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        const { account, keychain, startSignIn } = setUp();
        const { signingIn } = await startSignIn();

        jest.advanceTimersByTime(FIVE_MINUTES_MS);
        await signingIn;

        expect(account.getSnapshot()).toEqual({ status: "signed-out", failure: "timed-out" });
        expect(keychain.secrets.size).toBe(0);
      });

      it("says the website refused, on the browser page and in settings, when it denies the sign-in", async () => {
        const { account, service, startSignIn } = setUp();
        const { signingIn, signInUrl } = await startSignIn();

        const page = await visit(service.deny(signInUrl.href));
        await signingIn;

        expect(page.body).toContain("Sign-in didn't finish");
        expect(page.body).toContain("Sign-in was cancelled on the Copilot website.");
        expect(account.getSnapshot()).toEqual({
          status: "signed-out",
          failure: "cancelled-on-service",
        });
      });

      it("clears the previous failure when the user tries again", async () => {
        const { account, startSignIn } = setUp();
        const first = await startSignIn();
        account.cancelSignIn();
        await first.signingIn;

        await startSignIn();

        expect(account.getSnapshot()).toEqual({ status: "signing-in" });
      });
    });

    describe("openSignInPage()", () => {
      it("opens the sign-in page in progress again, install id included", async () => {
        const { account, browser, startSignIn } = setUp();
        const { signInUrl } = await startSignIn();

        account.openSignInPage();

        expect(browser.opened).toEqual([signInUrl.href, signInUrl.href]);
      });
    });

    describe("cancelSignIn()", () => {
      it("stops waiting for the browser, stores no login, and says the sign-in was cancelled", async () => {
        const { account, keychain, startSignIn } = setUp();
        const { signingIn, signInUrl } = await startSignIn();

        account.cancelSignIn();
        await signingIn;

        expect(account.getSnapshot()).toEqual({ status: "signed-out", failure: "cancelled" });
        expect(keychain.secrets.size).toBe(0);
        await expect(visit(signInUrl.searchParams.get("redirect_uri") ?? "")).rejects.toThrow(
          /ECONNREFUSED/
        );
      });
    });

    describe("refreshProfile()", () => {
      it("shows the plan the account has now", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        service.account = { ...service.account, plan: "plus", licenseKey: "key-1" };

        await account.refreshProfile();

        expect(account.getSnapshot()).toEqual(signedIn({ ...FREE_PROFILE, plan: "plus" }));
      });

      it("reads the account after a restart with the login this device kept", async () => {
        const { signIn, createAccount } = setUp();
        await signIn();
        const afterRestart = createAccount();

        await afterRestart.refreshProfile();

        expect(afterRestart.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
      });

      it("renews an expired login before reading the account", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        jest.setSystemTime(Date.now() + TWO_HOURS_MS);

        await account.refreshProfile();

        expect(service.requestsTo("/token")).toHaveLength(2);
        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
      });

      it("renews the login once and reads again when the website no longer accepts its access token — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        service.rejectAccessTokens();

        await account.refreshProfile();

        expect(service.requestsTo("/api/plugin/account")).toHaveLength(3);
        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
      });

      it("returns to signed out and drops the login when the website has ended it", async () => {
        const { account, keychain, service, signIn } = setUp();
        await signIn();
        service.rejectAccessTokens();
        service.rejectRefreshTokens();

        await account.refreshProfile();

        expect(account.getSnapshot()).toEqual({ status: "signed-out", failure: null });
        expect(keychain.secrets.size).toBe(0);
      });

      it("keeps showing the last plan read when the website can't be reached", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        service.unreachable = true;

        await account.refreshProfile();

        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
      });

      it("keeps the last plan read when the website answers with something other than an account", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        service.account = { error: "unexpected" };

        await account.refreshProfile();

        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
      });

      it("does nothing while signed out", async () => {
        const { account, service } = setUp();

        await account.refreshProfile();

        expect(service.requests).toHaveLength(0);
        expect(account.getSnapshot()).toEqual({ status: "signed-out", failure: null });
      });
    });

    describe("signOut()", () => {
      it("removes the login from this device and asks the website to end it", async () => {
        const { account, keychain, service, signIn } = setUp();
        await signIn();
        const revocation = service.nextRevocation();

        await account.signOut();

        expect(account.getSnapshot()).toEqual({ status: "signed-out", failure: null });
        expect(keychain.secrets.size).toBe(0);
        await expect(revocation).resolves.toMatch(/^refresh-/);
      });

      it("stays signed out when an account read in flight finishes after signing out", async () => {
        const { account, signIn } = setUp();
        await signIn();

        const reading = account.refreshProfile();
        await account.signOut();
        await reading;

        expect(account.getSnapshot()).toEqual({ status: "signed-out", failure: null });
      });
    });

    describe("dispose()", () => {
      it("cancels a sign-in in progress so its browser page stops answering", async () => {
        const { account, startSignIn } = setUp();
        const { signingIn, signInUrl } = await startSignIn();

        account.dispose();
        await signingIn;

        await expect(visit(signInUrl.searchParams.get("redirect_uri") ?? "")).rejects.toThrow(
          /ECONNREFUSED/
        );
      });
    });
  });
});
