import type {
  ConnectorAuth,
  ConnectorLogin,
  LoginOutcome,
  LoginResultCopy,
} from "@/connectors/oauth/connectorAuth";
import { CopilotPlusWelcomeModal } from "@/components/modals/CopilotPlusWelcomeModal";
import { requestUrlFetch } from "@/connectors/oauth/requestUrlFetch";
import { signInFailureMessage, type SignInFailure } from "@/copilotAccount/signInMessages";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logWarn } from "@/logger";
import {
  applyAccountLicense,
  checkIsPaidUser,
  isAccountLicense,
  removeLicense,
  turnOffPaid,
} from "@/plusUtils";
import { getSettings, subscribeToSettingsChange, type CopilotSettings } from "@/settings/model";
import type { App } from "obsidian";

const LOGIN_ID = "copilot-account";
const ACCOUNT_PATH = "/api/plugin/account";
const FREE_PLAN = "free";
const PURCHASE_RECHECK_INTERVAL_MS = 10_000;
const PURCHASE_RECHECKS = 6;

export interface AccountProfile {
  readonly email: string | null;
  readonly name: string | null;
  readonly plan: string;
}

export interface LicenseNotice {
  readonly kind: "applied" | "ended";
  readonly plan: string | null;
}

export type CopilotAccountState =
  | { readonly status: "signed-out"; readonly failure: SignInFailure | null }
  | { readonly status: "signing-in" }
  | {
      readonly status: "signed-in";
      readonly profile: AccountProfile | null;
      readonly notice: LicenseNotice | null;
    };

export interface CopilotAccountDeps {
  app: App;
  auth: Pick<ConnectorAuth, "login" | "accessToken" | "disconnect" | "hasLogin">;
  websiteOrigin: string;
  installId: () => string;
  openUrl: (url: string) => void;
}

const SIGNED_OUT: CopilotAccountState = Object.freeze({ status: "signed-out", failure: null });
const SIGNING_IN: CopilotAccountState = Object.freeze({ status: "signing-in" });

function signInResultCopy(result: LoginOutcome): LoginResultCopy {
  if (result.status === "failed") {
    return {
      heading: "Sign-in didn't finish",
      body: `${signInFailureMessage(result.reason)} Go back to Obsidian and click Sign in.`,
    };
  }
  return {
    heading: "You're signed in to Copilot",
    body: "You can close this tab and go back to Obsidian.",
  };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

interface AccountRead {
  readonly profile: AccountProfile;
  readonly licenseKey: string | null;
}

function parseAccount(body: unknown): AccountRead | null {
  if (typeof body !== "object" || body === null) return null;
  const { email, name, plan, licenseKey } = body as Record<string, unknown>;
  if (typeof plan !== "string") return null;
  if (!isNullableString(email) || !isNullableString(name) || !isNullableString(licenseKey)) {
    return null;
  }
  return { profile: Object.freeze({ email, name, plan }), licenseKey };
}

function signedIn(
  profile: AccountProfile | null,
  notice: LicenseNotice | null = null
): CopilotAccountState {
  return Object.freeze({ status: "signed-in", profile, notice });
}

function removeAccountLicense(): void {
  if (isAccountLicense(getSettings())) removeLicense();
}

export class CopilotAccount {
  private state: CopilotAccountState;
  private login: ConnectorLogin | null = null;
  private stopPurchaseWatch: (() => void) | null = null;
  private reading: { generation: number; done: Promise<void> } | null = null;
  private loginGeneration = 0;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeSettings: () => void;

  constructor(private readonly deps: CopilotAccountDeps) {
    const hasLogin = deps.auth.hasLogin(LOGIN_ID);
    this.state = hasLogin ? signedIn(null) : SIGNED_OUT;
    // A Sign out cut short by a restart leaves the account's license behind without its login.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/924
    if (!hasLogin) removeAccountLicense();
    this.unsubscribeSettings = subscribeToSettingsChange(this.showEndedLicense);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): CopilotAccountState => this.state;

  async signIn(): Promise<void> {
    if (this.login) return;
    const login = this.deps.auth.login({
      connectionId: LOGIN_ID,
      serverUrl: this.deps.websiteOrigin,
      serviceName: "Copilot",
      authorizationParams: this.authorizationParams(),
      resultCopy: signInResultCopy,
    });
    this.login = login;
    this.setState(SIGNING_IN);
    const outcome = await login.outcome;
    this.login = null;
    if (outcome.status === "connected") {
      this.setState(signedIn(null));
      await this.read(false);
      return;
    }
    const failure = outcome.status === "cancelled" ? "cancelled" : outcome.reason;
    this.setState(Object.freeze({ status: "signed-out", failure }));
  }

  openSignInPage(): void {
    const url = this.login?.loginUrl();
    if (url) this.deps.openUrl(url);
  }

  cancelSignIn(): void {
    this.login?.cancel();
  }

  refreshProfile(): Promise<void> {
    // Reads that overlap share one request, so an older answer never lands after a newer one and the purchase
    // watch's reads cannot pile up behind a slow website. https://github.com/Brevilabs/obsidian-copilot-private/issues/924
    if (this.reading?.generation === this.loginGeneration) return this.reading.done;
    const reading = {
      generation: this.loginGeneration,
      done: this.read(true).finally(() => {
        if (this.reading === reading) this.reading = null;
      }),
    };
    this.reading = reading;
    return reading.done;
  }

  async signOut(): Promise<void> {
    this.endSignIn();
    await this.deps.auth.disconnect(LOGIN_ID);
  }

  watchForPurchase(win: Window): void {
    if (this.state.status !== "signed-in") return;
    this.stopPurchaseWatch?.();
    let interval: number | undefined;
    let rechecksLeft = PURCHASE_RECHECKS;
    const unsubscribe = this.subscribe(() => {
      const plan =
        this.state.status === "signed-in" ? (this.state.profile?.plan ?? FREE_PLAN) : null;
      if (plan !== FREE_PLAN) stop();
    });
    // A purchase can take a moment to reach the account, so the check repeats for a minute after the user returns.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/924
    const onReturn = (): void => {
      win.removeEventListener("focus", onReturn);
      interval = win.setInterval(() => {
        rechecksLeft -= 1;
        if (rechecksLeft === 0) stop();
        void this.refreshProfile();
      }, PURCHASE_RECHECK_INTERVAL_MS);
      void this.refreshProfile();
    };
    const stop = (): void => {
      unsubscribe();
      win.removeEventListener("focus", onReturn);
      win.clearInterval(interval);
      if (this.stopPurchaseWatch === stop) this.stopPurchaseWatch = null;
    };
    this.stopPurchaseWatch = stop;
    win.addEventListener("focus", onReturn);
  }

  dispose(): void {
    // A read still in flight when the plugin unloads must not change the license or open a dialog afterwards.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/924
    this.state = SIGNED_OUT;
    this.loginGeneration += 1;
    this.login?.cancel();
    this.stopPurchaseWatch?.();
    this.unsubscribeSettings();
    this.listeners.clear();
  }

  private async read(announceLicense: boolean): Promise<void> {
    if (this.state.status !== "signed-in") return;
    const generation = this.loginGeneration;
    const account = await this.readAccount();
    if (generation !== this.loginGeneration || account === null) return;
    if (account === "needs-login") {
      this.endSignIn();
      return;
    }
    // Removed before the new plan shows, so the notice names the plan that ended.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/924
    if (account.licenseKey === null && isAccountLicense(getSettings())) turnOffPaid(this.deps.app);
    this.setState(signedIn(account.profile, this.notice()));
    if (account.licenseKey !== null) {
      await this.applyLicense(
        account.licenseKey,
        account.profile.plan,
        announceLicense,
        generation
      );
    }
  }

  private async applyLicense(
    licenseKey: string,
    plan: string,
    announce: boolean,
    generation: number
  ): Promise<void> {
    const stored = getSettings();
    // A pasted key wins over the account's unless the license server refuses it; a key not marked paid is asked about
    // first, so one whose check never ran or couldn't reach the server stays.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/924
    if (stored.plusLicenseKey !== "" && !isAccountLicense(stored)) {
      if (stored.isPaidUser) return;
      const { isValid } = await BrevilabsClient.getInstance()
        .validateLicenseKey(this.deps.app, { trigger: "manual" })
        .catch((error) => {
          logWarn("[Account] Couldn't check the pasted license key.", error);
          return { isValid: undefined };
        });
      if (isValid !== false || generation !== this.loginGeneration) return;
    }
    const settings = getSettings();
    // A refused key is removed, so the account's key still stored without paid features means its last check couldn't
    // run; it is checked again. https://github.com/Brevilabs/obsidian-copilot-private/issues/924
    const isStored = settings.plusLicenseKey === licenseKey;
    if (isStored && settings.isPaidUser) return;
    if (!isStored) applyAccountLicense(licenseKey);
    const paid = await checkIsPaidUser(this.deps.app, { trigger: "manual" });
    // The first sign-in on a paid plan applies quietly; a plan bought while signed in is announced, once.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/924
    if (
      !paid ||
      !announce ||
      isStored ||
      generation !== this.loginGeneration ||
      this.state.status !== "signed-in"
    ) {
      return;
    }
    this.setState(signedIn(this.state.profile, { kind: "applied", plan }));
    new CopilotPlusWelcomeModal(this.deps.app).open();
  }

  // Whatever removed the account's license while signed in (a free read or a refused license), the plan has ended.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/924
  private readonly showEndedLicense = (prev: CopilotSettings, next: CopilotSettings): void => {
    if (this.state.status !== "signed-in" || next.plusLicenseKey !== "") return;
    if (!isAccountLicense(prev)) return;
    const { profile } = this.state;
    const plan = profile && profile.plan !== FREE_PLAN ? profile.plan : null;
    const freeProfile = profile && Object.freeze({ ...profile, plan: FREE_PLAN });
    this.setState(signedIn(freeProfile, { kind: "ended", plan }));
  };

  private notice(): LicenseNotice | null {
    return this.state.status === "signed-in" ? this.state.notice : null;
  }

  private endSignIn(): void {
    this.setState(SIGNED_OUT);
    removeAccountLicense();
  }

  private authorizationParams(): Record<string, string> {
    try {
      return { install_id: this.deps.installId() };
    } catch (error) {
      // The website accepts a sign-in without an install id and keys the device on the login itself.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/923
      logWarn("[Account] Signing in without an install id.", error);
      return {};
    }
  }

  private async readAccount(): Promise<AccountRead | "needs-login" | null> {
    // A rejected access token gets one renewal; whether the website ended the login is the renewal's answer.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/923
    for (const forceRefresh of [false, true]) {
      const token = await this.deps.auth.accessToken(LOGIN_ID, { forceRefresh });
      if (token.status === "needs-login") return "needs-login";
      if (token.status === "unreachable") return null;
      let response: Response;
      try {
        response = await requestUrlFetch(`${this.deps.websiteOrigin}${ACCOUNT_PATH}`, {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        });
      } catch (error) {
        logWarn("[Account] Couldn't read the account.", error);
        return null;
      }
      if (response.status === 401) continue;
      // A network login page can answer 200 with HTML; that reads as unreachable, not as a failure to throw.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/923
      const account = response.ok ? parseAccount(await response.json().catch(() => null)) : null;
      if (!account) logWarn(`[Account] The account read answered HTTP ${response.status}.`);
      return account;
    }
    return null;
  }

  private setState(state: CopilotAccountState): void {
    // Leaving signed in ends the login, so a read started under it can't answer for the next sign-in.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/923
    if (state.status !== "signed-in") this.loginGeneration += 1;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
