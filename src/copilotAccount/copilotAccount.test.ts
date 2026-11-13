/**
 * @jest-environment node
 */
import {
  CopilotAccount,
  SIGN_IN_RETURN_LINK,
  type AccountProfile,
  type CopilotAccountState,
  type LicenseNotice,
} from "@/copilotAccount/copilotAccount";
import { ConnectorAuth } from "@/connectors/oauth/connectorAuth";
import { FAKE_SERVICE_ORIGIN, FakeOAuthService } from "@/connectors/oauth/testing/fakeOAuthService";
import { applyAccountLicense, checkIsPaidUser, isAccountLicense, removeLicense } from "@/plusUtils";
import { getSettings, setSettings } from "@/settings/model";
import { get as httpGet } from "node:http";
import * as obsidian from "obsidian";
import type { App, RequestUrlParam } from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const mockOpenWelcome = jest.fn();
jest.mock("@/components/modals/CopilotPlusWelcomeModal", () => ({
  CopilotPlusWelcomeModal: class {
    open() {
      mockOpenWelcome();
    }
  },
}));

const mockOpenExpired = jest.fn();
jest.mock("@/components/modals/CopilotPlusExpiredModal", () => ({
  CopilotPlusExpiredModal: class {
    open() {
      mockOpenExpired();
    }
  },
}));

const setRequestUrlImpl = (obsidian as unknown as { __setRequestUrlImpl: (impl: unknown) => void })
  .__setRequestUrlImpl;

const VAULT_ID = "abcd1234";
const LOGIN_KEYCHAIN_ID = `copilot-v${VAULT_ID}-connector-copilot-account`;
const INSTALL_ID = "0b7f1c5e-3f7a-4c2e-9d4b-1a2b3c4d5e6f";
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const ONE_MINUTE_MS = 60 * 1000;
const RECHECK_INTERVAL_MS = 10 * 1000;
const ACCOUNT_KEY = "account-issued-key";
const PASTED_KEY = "pasted-key";
const APP = {} as App;

const FREE_PROFILE: AccountProfile = {
  email: "you@example.com",
  name: "Your Name",
  plan: "free",
};

const PLUS_PROFILE: AccountProfile = { ...FREE_PROFILE, plan: "plus" };

const OTHER_KEY = "other-account-issued-key";
const OTHER_FREE_PROFILE: AccountProfile = {
  email: "other@example.com",
  name: "Other Name",
  plan: "free",
};
const OTHER_PLUS_PROFILE: AccountProfile = { ...OTHER_FREE_PROFILE, plan: "plus" };

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

function fakeWindow(): Window & { returnToObsidian: () => void } {
  const target = new EventTarget();
  return Object.assign(target, {
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    returnToObsidian: () => void target.dispatchEvent(new Event("focus")),
  }) as unknown as Window & { returnToObsidian: () => void };
}

function nextUpdate(account: CopilotAccount): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = account.subscribe(() => {
      unsubscribe();
      resolve();
    });
  });
}

function untilState(
  account: CopilotAccount,
  isReached: (state: CopilotAccountState) => boolean
): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = account.subscribe(() => {
      if (!isReached(account.getSnapshot())) return;
      unsubscribe();
      resolve();
    });
  });
}

function paidAccount(service: FakeOAuthService): Record<string, unknown> {
  return { ...service.account, plan: "plus", licenseKey: ACCOUNT_KEY };
}

function freeAccount(service: FakeOAuthService): Record<string, unknown> {
  return { ...service.account, plan: "free", licenseKey: null };
}

const accounts: CopilotAccount[] = [];

function linkParams(link: string): Record<string, string> {
  const url = new URL(link);
  return { action: url.host, ...Object.fromEntries(url.searchParams) };
}

function setUp({
  installId = () => INSTALL_ID,
  returnLink,
}: { installId?: () => string; returnLink?: string } = {}) {
  const service = new FakeOAuthService({
    supportsClientMetadataDocuments: true,
    publishesRevocation: true,
  });
  const licenseServer = {
    refuses: false,
    refusedKeys: new Set<string>(),
    unavailable: false,
    checks: 0,
  };
  const respond = async (request: RequestUrlParam) => {
    if (!request.url.endsWith("/license")) return service.requestUrl(request);
    licenseServer.checks += 1;
    if (licenseServer.unavailable) return { status: 503, headers: {}, text: "Service Unavailable" };
    const { license_key: licenseKey } = JSON.parse(request.body as string) as {
      license_key: string;
    };
    return licenseServer.refuses || licenseServer.refusedKeys.has(licenseKey)
      ? {
          status: 403,
          headers: {},
          json: { detail: { reason: "Invalid license key", error: "INVALID_LICENSE" } },
        }
      : { status: 200, headers: {}, json: { is_valid: true, plan: "plus" } };
  };
  setRequestUrlImpl(respond);
  const keychain = fakeKeychain();
  const browser = fakeBrowser();

  function createAccount(): CopilotAccount {
    const account = new CopilotAccount({
      app: APP,
      auth: new ConnectorAuth({ keychain, openUrl: browser.open, returnLink }),
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

  async function signInThroughLink(): Promise<Record<string, string>> {
    const { signingIn, signInUrl } = await startSignIn();
    const link = linkParams(service.approve(signInUrl.href));
    account.receiveReturnLink(link);
    await signingIn;
    return link;
  }

  return {
    service,
    licenseServer,
    respond,
    keychain,
    browser,
    account,
    createAccount,
    startSignIn,
    signIn,
    signInThroughLink,
  };
}

function holdNextRequest(
  respond: (request: RequestUrlParam) => Promise<unknown>,
  path: string
): {
  answered: Promise<void>;
  release: () => void;
} {
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let holding = true;
  setRequestUrlImpl(async (request: RequestUrlParam) => {
    if (!holding || !request.url.endsWith(path)) return respond(request);
    holding = false;
    const response = await respond(request);
    answer();
    await released;
    return response;
  });
  return { answered, release };
}

function signedIn(
  profile: AccountProfile | null,
  notice: LicenseNotice | null = null
): CopilotAccountState {
  return { status: "signed-in", profile, notice };
}

function pasteLicenseKey(): void {
  setSettings({ plusLicenseKey: PASTED_KEY, isPaidUser: true });
}

function pasteInactiveLicenseKey(): void {
  setSettings({ plusLicenseKey: PASTED_KEY, isPaidUser: false });
}

describe("copilotAccount", () => {
  beforeEach(() => {
    removeLicense();
    mockOpenWelcome.mockClear();
    mockOpenExpired.mockClear();
  });

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

      it("removes the account's license when a restart finds this device's login gone, as the interrupted Sign out would have — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", () => {
        const { createAccount } = setUp();
        applyAccountLicense(ACCOUNT_KEY);

        const afterRestart = createAccount();

        expect(afterRestart.getSnapshot()).toEqual({ status: "signed-out", failure: null });
        expect(getSettings().plusLicenseKey).toBe("");
      });

      it("keeps a pasted license key when a restart finds no login", () => {
        const { createAccount } = setUp();
        pasteLicenseKey();

        createAccount();

        expect(getSettings().plusLicenseKey).toBe(PASTED_KEY);
      });

      it("shows Free and says the plan ended, still signed in, when a paid feature is refused because the account's license is no longer valid — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, keychain, licenseServer, service, signIn } = setUp();
        service.account = paidAccount(service);
        await signIn();
        licenseServer.refuses = true;

        await checkIsPaidUser(APP, { trigger: "tool_call" });

        expect(account.getSnapshot()).toEqual(
          signedIn({ ...PLUS_PROFILE, plan: "free" }, { kind: "ended", plan: "plus" })
        );
        expect(getSettings().plusLicenseKey).toBe("");
        expect(getSettings().isPaidUser).toBe(false);
        expect(mockOpenExpired).toHaveBeenCalledTimes(1);
        expect([...keychain.secrets.keys()]).toEqual([LOGIN_KEYCHAIN_ID]);
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

      it("says the sign-in timed out, stores no login and offers Sign in again when the browser never returns through the link — https://github.com/Brevilabs/obsidian-copilot-private/issues/926", async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        const { account, keychain, startSignIn } = setUp({ returnLink: SIGN_IN_RETURN_LINK });
        const { signingIn, signInUrl } = await startSignIn();

        jest.advanceTimersByTime(FIVE_MINUTES_MS);
        await signingIn;

        expect(signInUrl.searchParams.get("redirect_uri")).toBe("obsidian://copilot-auth");
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

      it("applies a paid account's license key at sign-in, quietly, as the first sign-in on a paid plan shows no confirmation — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, service, signIn } = setUp();
        service.account = paidAccount(service);

        await signIn();

        expect(account.getSnapshot()).toEqual(signedIn(PLUS_PROFILE));
        expect(getSettings().plusLicenseKey).toBe(ACCOUNT_KEY);
        expect(getSettings().isPaidUser).toBe(true);
        expect(mockOpenWelcome).not.toHaveBeenCalled();
      });

      it("applies no license when a free account signs in", async () => {
        const { signIn } = setUp();

        await signIn();

        expect(getSettings().plusLicenseKey).toBe("");
        expect(getSettings().isPaidUser).toBe(false);
      });

      it("leaves an active pasted license key in place, without checking it, when a paid account signs in — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, licenseServer, service, signIn } = setUp();
        pasteLicenseKey();
        service.account = paidAccount(service);

        await signIn();

        expect(getSettings().plusLicenseKey).toBe(PASTED_KEY);
        expect(licenseServer.checks).toBe(0);
        expect(account.getSnapshot()).toEqual(signedIn(PLUS_PROFILE));
      });

      it("replaces a pasted key the license server refuses with a paid account's key, quietly, which then counts as the account's license — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, licenseServer, service, signIn } = setUp();
        pasteInactiveLicenseKey();
        licenseServer.refusedKeys.add(PASTED_KEY);
        service.account = paidAccount(service);

        await signIn();

        expect(getSettings().plusLicenseKey).toBe(ACCOUNT_KEY);
        expect(isAccountLicense(getSettings())).toBe(true);
        expect(getSettings().isPaidUser).toBe(true);
        expect(account.getSnapshot()).toEqual(signedIn(PLUS_PROFILE));
        expect(mockOpenWelcome).not.toHaveBeenCalled();
        expect(mockOpenExpired).not.toHaveBeenCalled();
      });

      it("keeps a pasted key that was not yet marked paid when the license server accepts it as a paid account signs in — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { service, signIn } = setUp();
        pasteInactiveLicenseKey();
        service.account = paidAccount(service);

        await signIn();

        expect(getSettings().plusLicenseKey).toBe(PASTED_KEY);
        expect(isAccountLicense(getSettings())).toBe(false);
        expect(getSettings().isPaidUser).toBe(true);
      });

      it("keeps an inactive pasted key whose license check can't reach the license server when a paid account signs in — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { licenseServer, service, signIn } = setUp();
        pasteInactiveLicenseKey();
        licenseServer.unavailable = true;
        service.account = paidAccount(service);

        await signIn();

        expect(getSettings().plusLicenseKey).toBe(PASTED_KEY);
        expect(isAccountLicense(getSettings())).toBe(false);
      });

      it("leaves a pasted key the license server refuses in place when a free account signs in — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { licenseServer, signIn } = setUp();
        pasteInactiveLicenseKey();
        licenseServer.refusedKeys.add(PASTED_KEY);

        await signIn();

        expect(getSettings().plusLicenseKey).toBe(PASTED_KEY);
        expect(licenseServer.checks).toBe(0);
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

      it("brings back Sign in and ignores the link the browser returns with afterwards on a device that signs in through a link — https://github.com/Brevilabs/obsidian-copilot-private/issues/926", async () => {
        const { account, keychain, service, startSignIn } = setUp({
          returnLink: SIGN_IN_RETURN_LINK,
        });
        const { signingIn, signInUrl } = await startSignIn();

        account.cancelSignIn();
        await signingIn;
        const requestsBefore = service.requests.length;
        account.receiveReturnLink(linkParams(service.approve(signInUrl.href)));

        expect(account.getSnapshot()).toEqual({ status: "signed-out", failure: "cancelled" });
        expect(service.requests.length).toBe(requestsBefore);
        expect(keychain.secrets.size).toBe(0);
      });
    });

    describe("receiveReturnLink()", () => {
      it("signs in and applies a paid account's license when the browser returns through the link with this sign-in's state — https://github.com/Brevilabs/obsidian-copilot-private/issues/926", async () => {
        const { account, keychain, service, signInThroughLink } = setUp({
          returnLink: SIGN_IN_RETURN_LINK,
        });
        service.account = paidAccount(service);

        await signInThroughLink();

        expect(account.getSnapshot()).toEqual(signedIn(PLUS_PROFILE));
        expect([...keychain.secrets.keys()]).toEqual([LOGIN_KEYCHAIN_ID]);
        expect(getSettings().plusLicenseKey).toBe(ACCOUNT_KEY);
        expect(getSettings().isPaidUser).toBe(true);
      });

      it("ignores a link with another sign-in's state, staying in progress until its own link returns — https://github.com/Brevilabs/obsidian-copilot-private/issues/926", async () => {
        const { account, service, startSignIn } = setUp({ returnLink: SIGN_IN_RETURN_LINK });
        const { signingIn, signInUrl } = await startSignIn();
        const link = linkParams(service.approve(signInUrl.href));

        account.receiveReturnLink({ ...link, code: "code-from-another-page", state: "another" });

        expect(account.getSnapshot()).toEqual({ status: "signing-in" });
        account.receiveReturnLink(link);
        await signingIn;
        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
        expect(service.requestsTo("/token")).toHaveLength(1);
      });

      it("ignores a link when no sign-in is in progress, and a replayed link once signed in, contacting no one — https://github.com/Brevilabs/obsidian-copilot-private/issues/926", async () => {
        const { account, keychain, service, signInThroughLink } = setUp({
          returnLink: SIGN_IN_RETURN_LINK,
        });
        account.receiveReturnLink({ action: "copilot-auth", code: "code-1", state: "state-1" });
        expect(account.getSnapshot()).toEqual({ status: "signed-out", failure: null });
        expect(service.requests).toEqual([]);
        const link = await signInThroughLink();
        const login = keychain.secrets.get(LOGIN_KEYCHAIN_ID);
        const requestsBefore = service.requests.length;

        account.receiveReturnLink(link);

        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
        expect(keychain.secrets.get(LOGIN_KEYCHAIN_ID)).toBe(login);
        expect(service.requests.length).toBe(requestsBefore);
      });

      it("ignores a link carrying the sign-in's state on a device that signs in through a local address — https://github.com/Brevilabs/obsidian-copilot-private/issues/926", async () => {
        const { account, service, startSignIn } = setUp();
        const { signingIn, signInUrl } = await startSignIn();
        const callback = new URL(service.approve(signInUrl.href));
        const requestsBefore = service.requests.length;

        account.receiveReturnLink({
          action: "copilot-auth",
          ...Object.fromEntries(callback.searchParams),
        });

        expect(account.getSnapshot()).toEqual({ status: "signing-in" });
        expect(service.requests.length).toBe(requestsBefore);
        await visit(callback.href);
        await signingIn;
        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
      });
    });

    describe("refreshProfile()", () => {
      it("applies the license, confirms it under the plan's name and opens the welcome when a signed-in free account turns paid — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        service.account = paidAccount(service);

        await account.refreshProfile();

        expect(account.getSnapshot()).toEqual(
          signedIn(PLUS_PROFILE, { kind: "applied", plan: "plus" })
        );
        expect(getSettings().plusLicenseKey).toBe(ACCOUNT_KEY);
        expect(getSettings().isPaidUser).toBe(true);
        expect(mockOpenWelcome).toHaveBeenCalledTimes(1);
      });

      it("checks the account's license again, quietly, when the check at sign-in couldn't reach the license server, and stops checking once it is active — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, licenseServer, service, signIn } = setUp();
        service.account = paidAccount(service);
        licenseServer.unavailable = true;
        await signIn();
        licenseServer.unavailable = false;

        await account.refreshProfile();
        const checksOnceActive = licenseServer.checks;
        await account.refreshProfile();

        expect(getSettings().plusLicenseKey).toBe(ACCOUNT_KEY);
        expect(getSettings().isPaidUser).toBe(true);
        expect(licenseServer.checks).toBe(checksOnceActive);
        expect(account.getSnapshot()).toEqual(signedIn(PLUS_PROFILE));
        expect(mockOpenWelcome).not.toHaveBeenCalled();
      });

      it("keeps the account's license as it is, without a confirmation, when a restart finds the same paid plan", async () => {
        const { service, signIn, createAccount } = setUp();
        service.account = paidAccount(service);
        await signIn();
        const afterRestart = createAccount();

        await afterRestart.refreshProfile();

        expect(afterRestart.getSnapshot()).toEqual(signedIn(PLUS_PROFILE));
        expect(getSettings().plusLicenseKey).toBe(ACCOUNT_KEY);
        expect(mockOpenWelcome).not.toHaveBeenCalled();
      });

      it("removes the account's license, says the plan ended and opens the plan-expired dialog when the account turns free, keeping the login — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, keychain, service, signIn } = setUp();
        service.account = paidAccount(service);
        await signIn();
        service.account = freeAccount(service);

        await account.refreshProfile();

        expect(account.getSnapshot()).toEqual(
          signedIn(FREE_PROFILE, { kind: "ended", plan: "plus" })
        );
        expect(getSettings().plusLicenseKey).toBe("");
        expect(getSettings().isPaidUser).toBe(false);
        expect(mockOpenExpired).toHaveBeenCalledTimes(1);
        expect([...keychain.secrets.keys()]).toEqual([LOGIN_KEYCHAIN_ID]);
      });

      it("says a plan ended without naming it when the first read after a restart finds the account free — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { service, signIn, createAccount } = setUp();
        service.account = paidAccount(service);
        await signIn();
        service.account = freeAccount(service);
        const afterRestart = createAccount();

        await afterRestart.refreshProfile();

        expect(afterRestart.getSnapshot()).toEqual(
          signedIn(FREE_PROFILE, { kind: "ended", plan: null })
        );
        expect(getSettings().plusLicenseKey).toBe("");
      });

      it("leaves a pasted license key in place while the account's plan changes — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, service, signIn } = setUp();
        pasteLicenseKey();
        await signIn();

        service.account = paidAccount(service);
        await account.refreshProfile();
        service.account = freeAccount(service);
        await account.refreshProfile();

        expect(getSettings().plusLicenseKey).toBe(PASTED_KEY);
        expect(getSettings().isPaidUser).toBe(true);
        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
        expect(mockOpenWelcome).not.toHaveBeenCalled();
        expect(mockOpenExpired).not.toHaveBeenCalled();
      });

      it("replaces a pasted key the license server refuses with the account's key, confirming it and opening the welcome, when Refresh plan finds the account turned paid — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, licenseServer, service, signIn } = setUp();
        pasteInactiveLicenseKey();
        licenseServer.refusedKeys.add(PASTED_KEY);
        await signIn();
        service.account = paidAccount(service);

        await account.refreshProfile();

        expect(getSettings().plusLicenseKey).toBe(ACCOUNT_KEY);
        expect(isAccountLicense(getSettings())).toBe(true);
        expect(account.getSnapshot()).toEqual(
          signedIn(PLUS_PROFILE, { kind: "applied", plan: "plus" })
        );
        expect(mockOpenWelcome).toHaveBeenCalledTimes(1);
        expect(mockOpenExpired).not.toHaveBeenCalled();
      });

      it("takes a key the user replaced the account's with as pasted — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, service, signIn } = setUp();
        service.account = paidAccount(service);
        await signIn();
        setSettings({ plusLicenseKey: PASTED_KEY });
        service.account = freeAccount(service);

        await account.refreshProfile();

        expect(getSettings().plusLicenseKey).toBe(PASTED_KEY);
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

      it("returns to signed out, dropping the login and the account's license, when the website has ended it — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, keychain, service, signIn } = setUp();
        service.account = paidAccount(service);
        await signIn();
        service.rejectAccessTokens();
        service.rejectRefreshTokens();

        await account.refreshProfile();

        expect(account.getSnapshot()).toEqual({ status: "signed-out", failure: null });
        expect(keychain.secrets.size).toBe(0);
        expect(getSettings().plusLicenseKey).toBe("");
      });

      it("keeps the license and the last plan read when the website can't be reached — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, service, signIn } = setUp();
        service.account = paidAccount(service);
        await signIn();
        service.account = freeAccount(service);
        service.unreachable = true;

        await account.refreshProfile();

        expect(account.getSnapshot()).toEqual(signedIn(PLUS_PROFILE));
        expect(getSettings().plusLicenseKey).toBe(ACCOUNT_KEY);
        expect(getSettings().isPaidUser).toBe(true);
      });

      it("keeps the last plan read when the website answers with something other than an account", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        service.account = { error: "unexpected" };

        await account.refreshProfile();

        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
      });

      it("keeps the last plan read when the website answers with a page that isn't JSON — https://github.com/Brevilabs/obsidian-copilot-private/issues/923", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        setRequestUrlImpl(async (request: { url: string }) =>
          request.url.endsWith("/api/plugin/account")
            ? { status: 200, headers: {}, text: "<html>Sign in to the network</html>" }
            : service.requestUrl(request)
        );

        await account.refreshProfile();

        expect(account.getSnapshot()).toEqual(signedIn(FREE_PROFILE));
      });

      it("shares one account read between refreshes that overlap, so an older answer never lands after a newer one — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        const readsBefore = service.requestsTo("/api/plugin/account").length;

        await Promise.all([account.refreshProfile(), account.refreshProfile()]);

        expect(service.requestsTo("/api/plugin/account")).toHaveLength(readsBefore + 1);
      });

      it("applies only the license of the account signed in now when an earlier account's paid answer arrives after the user switched accounts — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, respond, service, signIn } = setUp();
        await signIn();
        service.account = paidAccount(service);
        const firstAccount = holdNextRequest(respond, "/api/plugin/account");
        const firstAccountRead = account.refreshProfile();
        await firstAccount.answered;
        await account.signOut();
        service.account = { ...OTHER_PLUS_PROFILE, image: null, licenseKey: OTHER_KEY };
        await signIn();

        firstAccount.release();
        await firstAccountRead;

        expect(account.getSnapshot()).toEqual(signedIn(OTHER_PLUS_PROFILE));
        expect(getSettings().plusLicenseKey).toBe(OTHER_KEY);
        expect(getSettings().accountLicenseKey).toBe(OTHER_KEY);
        expect(mockOpenWelcome).not.toHaveBeenCalled();
      });

      it("announces nothing when the user signs out and back in while the license check for an upgrade is still running — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, respond, service, signIn } = setUp();
        await signIn();
        service.account = paidAccount(service);
        const upgradeLicenseCheck = holdNextRequest(respond, "/license");
        const upgradeRead = account.refreshProfile();
        await upgradeLicenseCheck.answered;
        await account.signOut();
        await signIn();

        upgradeLicenseCheck.release();
        await upgradeRead;

        expect(account.getSnapshot()).toEqual(signedIn(PLUS_PROFILE));
        expect(getSettings().plusLicenseKey).toBe(ACCOUNT_KEY);
        expect(mockOpenWelcome).not.toHaveBeenCalled();
      });

      it("sends its own account read after the user switched accounts instead of joining one still waiting for the earlier account — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, respond, service, signIn } = setUp();
        await signIn();
        const firstAccount = holdNextRequest(respond, "/api/plugin/account");
        const firstAccountRead = account.refreshProfile();
        await firstAccount.answered;
        await account.signOut();
        service.account = { ...OTHER_FREE_PROFILE, image: null, licenseKey: null };
        await signIn();
        service.account = { ...OTHER_PLUS_PROFILE, image: null, licenseKey: OTHER_KEY };
        const readsBefore = service.requestsTo("/api/plugin/account").length;

        const secondAccountRead = account.refreshProfile();
        firstAccount.release();
        await Promise.all([firstAccountRead, secondAccountRead]);

        expect(service.requestsTo("/api/plugin/account")).toHaveLength(readsBefore + 1);
        expect(account.getSnapshot()).toEqual(
          signedIn(OTHER_PLUS_PROFILE, { kind: "applied", plan: "plus" })
        );
        expect(getSettings().plusLicenseKey).toBe(OTHER_KEY);
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

      it("removes the license that came from the account — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, service, signIn } = setUp();
        service.account = paidAccount(service);
        await signIn();

        await account.signOut();

        expect(getSettings().plusLicenseKey).toBe("");
        expect(getSettings().isPaidUser).toBe(false);
        expect(mockOpenExpired).not.toHaveBeenCalled();
      });

      it("leaves a pasted license key in place — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, service, signIn } = setUp();
        pasteLicenseKey();
        service.account = paidAccount(service);
        await signIn();

        await account.signOut();

        expect(getSettings().plusLicenseKey).toBe(PASTED_KEY);
        expect(getSettings().isPaidUser).toBe(true);
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

    describe("watchForPurchase()", () => {
      it("picks up a purchase as soon as the user returns to Obsidian — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        const win = fakeWindow();
        account.watchForPurchase(win);
        service.account = paidAccount(service);

        const applied = untilState(
          account,
          (state) => state.status === "signed-in" && !!state.notice
        );
        win.returnToObsidian();
        await applied;

        expect(account.getSnapshot()).toEqual(
          signedIn(PLUS_PROFILE, { kind: "applied", plan: "plus" })
        );
        expect(getSettings().plusLicenseKey).toBe(ACCOUNT_KEY);
        expect(mockOpenWelcome).toHaveBeenCalledTimes(1);
      });

      it("keeps checking the account every 10 seconds for one minute after the return, then stops — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        const win = fakeWindow();
        const reads = () => service.requestsTo("/api/plugin/account").length;
        const readsBefore = reads();
        const refresh = jest.spyOn(account, "refreshProfile");
        const latestRead = (): Promise<void> =>
          refresh.mock.results[refresh.mock.results.length - 1].value as Promise<void>;
        account.watchForPurchase(win);

        win.returnToObsidian();
        await latestRead();
        for (let elapsed = 0; elapsed < ONE_MINUTE_MS; elapsed += RECHECK_INTERVAL_MS) {
          jest.advanceTimersByTime(RECHECK_INTERVAL_MS);
          await latestRead();
        }

        expect(reads() - readsBefore).toBe(7);
        expect(jest.getTimerCount()).toBe(0);
      });

      it("waits for the return to Obsidian before checking", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        const readsBefore = service.requestsTo("/api/plugin/account").length;

        account.watchForPurchase(fakeWindow());

        expect(jest.getTimerCount()).toBe(0);
        expect(service.requestsTo("/api/plugin/account")).toHaveLength(readsBefore);
      });

      it("keeps a single watch, on the window of the latest See plans, when the user chooses it again", async () => {
        const { account, signIn } = setUp();
        await signIn();
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        const firstWindow = fakeWindow();
        const latestWindow = fakeWindow();
        const refresh = jest.spyOn(account, "refreshProfile");
        account.watchForPurchase(firstWindow);
        account.watchForPurchase(latestWindow);

        firstWindow.returnToObsidian();
        expect(refresh).not.toHaveBeenCalled();
        latestWindow.returnToObsidian();
        await (refresh.mock.results[0].value as Promise<void>);

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(1);
      });

      it("stops checking once the purchase is found", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        const win = fakeWindow();
        account.watchForPurchase(win);
        service.account = paidAccount(service);

        const applied = untilState(
          account,
          (state) => state.status === "signed-in" && !!state.notice
        );
        win.returnToObsidian();
        await applied;

        expect(jest.getTimerCount()).toBe(0);
      });

      it("stops checking when the user signs out", async () => {
        const { account, signIn } = setUp();
        await signIn();
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        const win = fakeWindow();
        account.watchForPurchase(win);
        const firstRead = nextUpdate(account);
        win.returnToObsidian();
        await firstRead;

        await account.signOut();

        expect(jest.getTimerCount()).toBe(0);
      });
    });

    describe("dispose()", () => {
      it("stops checking for a purchase when the plugin unloads", async () => {
        const { account, signIn } = setUp();
        await signIn();
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        const win = fakeWindow();
        account.watchForPurchase(win);
        const firstRead = nextUpdate(account);
        win.returnToObsidian();
        await firstRead;

        account.dispose();

        expect(jest.getTimerCount()).toBe(0);
      });

      it("changes no license and opens no dialog when an account read finishes after the plugin unloads — https://github.com/Brevilabs/obsidian-copilot-private/issues/924", async () => {
        const { account, service, signIn } = setUp();
        await signIn();
        service.account = paidAccount(service);

        const reading = account.refreshProfile();
        account.dispose();
        await reading;

        expect(getSettings().plusLicenseKey).toBe("");
        expect(mockOpenWelcome).not.toHaveBeenCalled();
      });

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
