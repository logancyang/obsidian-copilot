export type SignInFailureReason = "cancelled-on-service" | "timed-out" | "rejected" | "unreachable";

export type SignInOutcome =
  | { status: "connected" }
  | { status: "cancelled" }
  | { status: "failed"; reason: SignInFailureReason };

export interface SignInResultCopy {
  heading: string;
  body: string;
}

export interface AccountSignInTarget {
  connectionId: string;
  serverUrl: string;
  serviceName: string;
  authorizationParams: Readonly<Record<string, string>>;
  resultCopy: (result: SignInOutcome) => SignInResultCopy;
}

export interface AccountSignIn {
  readonly outcome: Promise<SignInOutcome>;
  loginUrl(): string | null;
  cancel(): void;
}

export type AccountAccessToken =
  | { status: "connected"; accessToken: string }
  | { status: "needs-login" }
  | { status: "unreachable" };

export interface AccountAuth {
  hasLogin(connectionId: string): boolean;
  login(target: AccountSignInTarget): AccountSignIn;
  accessToken(
    connectionId: string,
    options: { forceRefresh?: boolean }
  ): Promise<AccountAccessToken>;
  disconnect(connectionId: string): Promise<void>;
}
