import type {
  ConnectorAuth,
  ConnectorLogin,
  LoginOutcome,
  LoginResultCopy,
} from "@/connectors/oauth/connectorAuth";
import { requestUrlFetch } from "@/connectors/oauth/requestUrlFetch";
import { signInFailureMessage, type SignInFailure } from "@/copilotAccount/signInMessages";
import { logWarn } from "@/logger";

const LOGIN_ID = "copilot-account";
const ACCOUNT_PATH = "/api/plugin/account";

export interface AccountProfile {
  readonly email: string | null;
  readonly name: string | null;
  readonly plan: string;
}

export type CopilotAccountState =
  | { readonly status: "signed-out"; readonly failure: SignInFailure | null }
  | { readonly status: "signing-in" }
  | { readonly status: "signed-in"; readonly profile: AccountProfile | null };

export interface CopilotAccountDeps {
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

function parseProfile(body: unknown): AccountProfile | null {
  if (typeof body !== "object" || body === null) return null;
  const { email, name, plan } = body as Record<string, unknown>;
  if (typeof plan !== "string") return null;
  if (!isNullableString(email) || !isNullableString(name)) return null;
  return Object.freeze({ email, name, plan });
}

function signedIn(profile: AccountProfile | null): CopilotAccountState {
  return Object.freeze({ status: "signed-in", profile });
}

export class CopilotAccount {
  private state: CopilotAccountState;
  private login: ConnectorLogin | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: CopilotAccountDeps) {
    this.state = deps.auth.hasLogin(LOGIN_ID) ? signedIn(null) : SIGNED_OUT;
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
      await this.refreshProfile();
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

  async refreshProfile(): Promise<void> {
    if (this.state.status !== "signed-in") return;
    const profile = await this.readProfile();
    if (this.state.status !== "signed-in" || profile === null) return;
    this.setState(profile === "needs-login" ? SIGNED_OUT : signedIn(profile));
  }

  async signOut(): Promise<void> {
    this.setState(SIGNED_OUT);
    await this.deps.auth.disconnect(LOGIN_ID);
  }

  dispose(): void {
    this.login?.cancel();
    this.listeners.clear();
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

  private async readProfile(): Promise<AccountProfile | "needs-login" | null> {
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
      const profile = response.ok ? parseProfile(await response.json()) : null;
      if (!profile) logWarn(`[Account] The account read answered HTTP ${response.status}.`);
      return profile;
    }
    return null;
  }

  private setState(state: CopilotAccountState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
