import EncryptionService from '@/encryptionService';
import { CopilotSettings } from '@/settings/SettingsPage';
import { Platform } from 'obsidian';

// Mocking Electron's safeStorage
jest.mock('electron', () => {
  return {
    remote: {
      safeStorage: {
        encryptString: jest.fn().mockImplementation((text) => `encrypted_${text}`),
        decryptString: jest.fn().mockImplementation((buffer) => buffer.toString().replace('encrypted_', '')),
        isEncryptionAvailable: jest.fn().mockReturnValue(true),
      },
    },
  }
});

describe('Platform-specific Tests', () => {
  it('should recognize the platform as desktop', () => {
    expect(Platform.isDesktop).toBe(true); // Directly using the mocked value
  });

  // Example of a conditional test based on the platform
  it('should only run certain logic on desktop', () => {
    if (Platform.isDesktop) {
      // Your desktop-specific logic here
      expect(true).toBe(true); // Replace with actual assertions
    } else {
      expect(true).toBe(false); // This line is just for demonstration and should be replaced
    }
  });
});

interface TestSettings extends CopilotSettings {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

describe('EncryptionService', () => {
  let service: EncryptionService;
  let settings: TestSettings;

  beforeEach(() => {
    jest.resetModules();
    settings = {
      enableEncryption: true,
      // Add other necessary settings here
    } as CopilotSettings;
    service = new EncryptionService(settings);
  });

  describe('getEncryptedKey', () => {
    it('should encrypt an API key', () => {
      const apiKey = 'testApiKey';
      const encryptedKey = service.getEncryptedKey(apiKey);
      expect(encryptedKey).toBe(`enc_encrypted_${apiKey}`);
    });

    it('should return the original key if encryption is not enabled', () => {
      settings.enableEncryption = false;
      const apiKey = 'testApiKey';
      const encryptedKey = service.getEncryptedKey(apiKey);
      expect(encryptedKey).toBe(apiKey);
    });

    it('should return the original key if already encrypted', () => {
      const apiKey = 'enc_testApiKey';
      const encryptedKey = service.getEncryptedKey(apiKey);
      expect(encryptedKey).toBe(apiKey);
    });
  });

  describe('getDecryptedKey', () => {
    it('should decrypt an encrypted API key', () => {
      const apiKey = 'testApiKey';
      const mockEncryptedKey = `encrypted_${apiKey}`;
      const base64Encoded = Buffer.from(mockEncryptedKey).toString('base64');
      const encryptedKey = `enc_${base64Encoded}`;

      const decryptedKey = service.getDecryptedKey(encryptedKey);
      expect(decryptedKey).toBe(apiKey);
    });

    it('should return the original key if it is in plain text', () => {
      const apiKey = 'testApiKey';
      const decryptedKey = service.getDecryptedKey(apiKey);
      expect(decryptedKey).toBe(apiKey);
    });
  });

  describe('encryptAllKeys', () => {
    beforeEach(() => {
      settings = {
        enableEncryption: true,
        someApiKey: 'testApiKey',
        anotherApiKey: 'anotherTestApiKey',
        nonKey: 'shouldBeIgnored',
      } as unknown as CopilotSettings;
      service = new EncryptionService(settings);
    });

    it('should encrypt all keys containing "apikey"', () => {
      service.encryptAllKeys();
      expect(settings.someApiKey).toBe('enc_encrypted_testApiKey');
      expect(settings.anotherApiKey).toBe('enc_encrypted_anotherTestApiKey');
      expect(settings.nonApiKey).toBe(undefined);
    });

    it('should not encrypt keys when encryption is not enabled', () => {
      settings.enableEncryption = false;
      service.encryptAllKeys();
      expect(settings.someApiKey).toBe('testApiKey');
      expect(settings.anotherApiKey).toBe('anotherTestApiKey');
    });
  });
});