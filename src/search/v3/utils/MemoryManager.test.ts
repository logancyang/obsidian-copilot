import { MemoryManager } from "./MemoryManager";
import { getSettings } from "@/settings/model";

// Mock the settings module
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));

// Mock logger
jest.mock("@/logger");

describe("MemoryManager", () => {
  const mockGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should use default RAM limit when not specified", () => {
    mockGetSettings.mockReturnValue({
      lexicalSearchRamLimit: undefined,
    } as any);

    const manager = new MemoryManager();
    // Default is 100 MB = 104,857,600 bytes
    expect(manager.getMaxBytes()).toBe(100 * 1024 * 1024);
  });

  it("should respect configured RAM limit", () => {
    mockGetSettings.mockReturnValue({
      lexicalSearchRamLimit: 200,
    } as any);

    const manager = new MemoryManager();
    // 200 MB = 209,715,200 bytes
    expect(manager.getMaxBytes()).toBe(200 * 1024 * 1024);
  });

  it("should enforce minimum RAM limit of 20 MB", () => {
    mockGetSettings.mockReturnValue({
      lexicalSearchRamLimit: 10, // Below minimum
    } as any);

    const manager = new MemoryManager();
    // Should clamp to 20 MB minimum
    expect(manager.getMaxBytes()).toBe(20 * 1024 * 1024);
  });

  it("should enforce maximum RAM limit of 1000 MB", () => {
    mockGetSettings.mockReturnValue({
      lexicalSearchRamLimit: 2000, // Above maximum
    } as any);

    const manager = new MemoryManager();
    // Should clamp to 1000 MB maximum
    expect(manager.getMaxBytes()).toBe(1000 * 1024 * 1024);
  });

  it("should calculate candidate limit based on RAM", () => {
    // Test with 100 MB (default)
    mockGetSettings.mockReturnValue({
      lexicalSearchRamLimit: 100,
    } as any);

    let manager = new MemoryManager();
    // 100 MB * 5 = 500, but capped at DEFAULT_CANDIDATE_LIMIT (500)
    expect(manager.getCandidateLimit()).toBe(500);

    // Test with 50 MB
    mockGetSettings.mockReturnValue({
      lexicalSearchRamLimit: 50,
    } as any);

    manager = new MemoryManager();
    // 50 MB * 5 = 250
    expect(manager.getCandidateLimit()).toBe(250);

    // Test with 200 MB
    mockGetSettings.mockReturnValue({
      lexicalSearchRamLimit: 200,
    } as any);

    manager = new MemoryManager();
    // 200 MB * 5 = 1000, but capped at 500
    expect(manager.getCandidateLimit()).toBe(500);
  });

  it("should track memory usage correctly", () => {
    mockGetSettings.mockReturnValue({
      lexicalSearchRamLimit: 100,
    } as any);

    const manager = new MemoryManager();
    expect(manager.getBytesUsed()).toBe(0);
    expect(manager.getUsagePercent()).toBe(0);

    // Add 10 MB
    const tenMB = 10 * 1024 * 1024;
    manager.addBytes(tenMB);
    expect(manager.getBytesUsed()).toBe(tenMB);
    expect(manager.getUsagePercent()).toBe(10);

    // Add another 40 MB (total 50 MB)
    const fortyMB = 40 * 1024 * 1024;
    manager.addBytes(fortyMB);
    expect(manager.getBytesUsed()).toBe(tenMB + fortyMB);
    expect(manager.getUsagePercent()).toBe(50);
  });

  it("should check if content can be added within budget", () => {
    mockGetSettings.mockReturnValue({
      lexicalSearchRamLimit: 100,
    } as any);

    const manager = new MemoryManager();
    const fiftyMB = 50 * 1024 * 1024;
    const sixtyMB = 60 * 1024 * 1024;

    // Should be able to add 50 MB
    expect(manager.canAddContent(fiftyMB)).toBe(true);

    // Add 50 MB
    manager.addBytes(fiftyMB);

    // Should still be able to add another 50 MB (total would be 100 MB)
    expect(manager.canAddContent(fiftyMB)).toBe(true);

    // Should NOT be able to add 60 MB (would exceed 100 MB limit)
    expect(manager.canAddContent(sixtyMB)).toBe(false);
  });

  it("should reset memory tracking", () => {
    mockGetSettings.mockReturnValue({
      lexicalSearchRamLimit: 100,
    } as any);

    const manager = new MemoryManager();

    // Add some bytes
    manager.addBytes(50 * 1024 * 1024);
    expect(manager.getBytesUsed()).toBeGreaterThan(0);

    // Reset
    manager.reset();
    expect(manager.getBytesUsed()).toBe(0);
    expect(manager.getUsagePercent()).toBe(0);
  });

  it("should calculate byte size of strings correctly", () => {
    // ASCII characters (1 byte each)
    expect(MemoryManager.getByteSize("hello")).toBe(5);

    // Unicode characters (emoji is 4 bytes)
    expect(MemoryManager.getByteSize("👍")).toBe(4);

    // Mixed content
    expect(MemoryManager.getByteSize("hello 👍")).toBe(10); // 6 ASCII + 1 space + 4 emoji
  });
});
