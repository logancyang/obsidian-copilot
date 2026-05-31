import { buildCopilotPlusEnv } from "./copilotPlusEnv";
import { getSettings } from "@/settings/model";
import { getDecryptedKey } from "@/encryptionService";
import { BREVILABS_API_BASE_URL } from "@/constants";
import { PLUS_ENV } from "@/agentMode/skills/builtin/builtinSkills";

jest.mock("@/settings/model", () => ({ getSettings: jest.fn() }));
jest.mock("@/encryptionService", () => ({ getDecryptedKey: jest.fn() }));
jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const mockGetSettings = getSettings as jest.Mock;
const mockGetDecryptedKey = getDecryptedKey as jest.Mock;

beforeEach(() => {
  mockGetSettings.mockReset();
  mockGetDecryptedKey.mockReset();
});

describe("buildCopilotPlusEnv", () => {
  it("returns the decrypted license + relay config for an active Plus user", async () => {
    mockGetSettings.mockReturnValue({
      isPlusUser: true,
      plusLicenseKey: "encrypted-key",
      userId: "user-123",
    });
    mockGetDecryptedKey.mockResolvedValue("plain-key");

    const env = await buildCopilotPlusEnv("4.0.0");

    expect(env).toEqual({
      [PLUS_ENV.licenseKey]: "plain-key",
      [PLUS_ENV.baseUrl]: BREVILABS_API_BASE_URL,
      [PLUS_ENV.userId]: "user-123",
      [PLUS_ENV.clientVersion]: "4.0.0",
    });
  });

  it("returns empty when the user is not a Plus subscriber", async () => {
    mockGetSettings.mockReturnValue({ isPlusUser: false, plusLicenseKey: "encrypted-key" });
    expect(await buildCopilotPlusEnv()).toEqual({});
    expect(mockGetDecryptedKey).not.toHaveBeenCalled();
  });

  it("returns empty when there is no license key on file", async () => {
    mockGetSettings.mockReturnValue({ isPlusUser: true, plusLicenseKey: "" });
    expect(await buildCopilotPlusEnv()).toEqual({});
    expect(mockGetDecryptedKey).not.toHaveBeenCalled();
  });

  it("returns empty (not a throw) when decryption fails", async () => {
    mockGetSettings.mockReturnValue({ isPlusUser: true, plusLicenseKey: "encrypted-key" });
    mockGetDecryptedKey.mockRejectedValue(new Error("bad key"));
    expect(await buildCopilotPlusEnv()).toEqual({});
  });

  it("returns empty when the decrypted key is blank", async () => {
    mockGetSettings.mockReturnValue({ isPlusUser: true, plusLicenseKey: "encrypted-key" });
    mockGetDecryptedKey.mockResolvedValue("");
    expect(await buildCopilotPlusEnv()).toEqual({});
  });
});
