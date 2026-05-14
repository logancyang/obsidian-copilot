/**
 * Tests for PasswordInput — pins the "decrypt on first mount only" contract.
 *
 * Reason: an earlier revision of this component re-ran decryption on every
 * prop update whenever `hasEncryptionPrefix(value)` returned true. That
 * silently cleared any plaintext API key starting with `enc_*` after the
 * user typed it (codex review #3234676133). The first-mount-only guard
 * below makes sure typed plaintext is never re-interpreted as ciphertext.
 */

import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PasswordInput } from "./password-input";

const mockGetDecryptedKey = jest.fn<Promise<string>, [string]>();
const mockHasEncryptionPrefix = jest.fn<boolean, [string]>();

jest.mock("@/encryptionService", () => ({
  getDecryptedKey: (value: string) => mockGetDecryptedKey(value),
  hasEncryptionPrefix: (value: string) => mockHasEncryptionPrefix(value),
}));

jest.mock("@/logger", () => ({ logError: jest.fn() }));

jest.mock("@/utils", () => ({ err2String: (e: unknown) => String(e) }));

// Reason: shadcn `<Input>` doesn't bring useful behavior to these tests —
// mock to a plain <input> so we can drive .value directly.
jest.mock("@/components/ui/input", () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    function Input(props, ref) {
      return <input ref={ref} {...props} />;
    }
  ),
}));

// Reason: lucide icons render to nothing useful in tests; stub them out.
jest.mock("lucide-react", () => ({
  Eye: () => <span data-testid="eye" />,
  EyeOff: () => <span data-testid="eye-off" />,
}));

beforeEach(() => {
  jest.clearAllMocks();
  // Default: prefix detector treats `enc_*` as encrypted.
  mockHasEncryptionPrefix.mockImplementation((v: string) => Boolean(v) && v.startsWith("enc_"));
});

describe("PasswordInput", () => {
  it("decrypts on first mount when the initial value is encrypted", async () => {
    mockGetDecryptedKey.mockResolvedValueOnce("sk-real");

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<PasswordInput value="enc_payload" />);
      await mockGetDecryptedKey.mock.results[0]?.value;
    });

    const input = view.container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("sk-real");
    expect(mockGetDecryptedKey).toHaveBeenCalledTimes(1);
  });

  it("shows the decryption-failed message when the initial value cannot be decrypted", async () => {
    mockGetDecryptedKey.mockResolvedValueOnce("");

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<PasswordInput value="enc_garbled" />);
      await mockGetDecryptedKey.mock.results[0]?.value;
    });

    const input = view.container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.getByText(/Unable to decrypt this key/i)).not.toBeNull();
  });

  it("does NOT decrypt plaintext starting with enc_* once the user has typed it", async () => {
    // Reason: regression guard. With the old prefix-anytime logic, the
    // controlled prop echo of the user's input would re-enter the effect
    // and clear the field via `getDecryptedKey() === ""`.
    function Harness() {
      const [v, setV] = useState("");
      return <PasswordInput value={v} onChange={setV} />;
    }

    const view = render(<Harness />);
    const input = view.container.querySelector("input") as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "enc_test" } });
    });

    // Reason: even though `hasEncryptionPrefix("enc_test")` is true, the
    // first-mount guard blocks any decrypt — user input survives intact.
    expect(input.value).toBe("enc_test");
    expect(mockGetDecryptedKey).not.toHaveBeenCalled();
    expect(screen.queryByText(/Unable to decrypt this key/i)).toBeNull();
  });

  it("does NOT decrypt when value is initially empty and later set to enc_*-shaped plaintext", async () => {
    // Reason: an empty initial render must still consume the first-load
    // budget — otherwise pasting `enc_*`-prefixed plaintext later would
    // trigger a stale decrypt and clear the input.
    let setV!: (s: string) => void;
    function Harness() {
      const [v, set] = useState("");
      setV = set;
      return <PasswordInput value={v} onChange={set} />;
    }

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<Harness />);
    });
    const input = view.container.querySelector("input") as HTMLInputElement;

    await act(async () => {
      setV("enc_paste");
    });

    expect(input.value).toBe("enc_paste");
    expect(mockGetDecryptedKey).not.toHaveBeenCalled();
  });

  it("does NOT decrypt when autoDecrypt is false even on first mount", async () => {
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<PasswordInput value="enc_payload" autoDecrypt={false} />);
    });

    const input = view.container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("enc_payload");
    expect(mockGetDecryptedKey).not.toHaveBeenCalled();
  });
});
