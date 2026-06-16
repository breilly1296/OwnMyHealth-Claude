/**
 * decryptOriginalFilename (L24) tests — the resolve-for-display helper for the
 * encrypted-at-rest UserFile.originalFilename, including its legacy/decrypt-fail
 * fallbacks and a real encrypt→decrypt round-trip.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { decryptOriginalFilename } from './userFileNames.js';
import type { getEncryptionService } from '../services/encryption.js';

type Enc = ReturnType<typeof getEncryptionService>;
const mockEnc = (decrypt: (ct: string, salt: string) => string): Enc =>
  ({ decrypt } as unknown as Enc);

describe('decryptOriginalFilename (L24) — fallbacks', () => {
  it('decrypts the encrypted twin when present', () => {
    const enc = mockEnc((ct) => `dec(${ct})`);
    expect(
      decryptOriginalFilename({ originalFilename: null, originalFilenameEncrypted: 'CT' }, enc, 'salt')
    ).toBe('dec(CT)');
  });

  it('falls back to legacy plaintext when there is no encrypted twin', () => {
    const enc = mockEnc(() => { throw new Error('decrypt must not be called'); });
    expect(
      decryptOriginalFilename({ originalFilename: 'legacy.pdf', originalFilenameEncrypted: null }, enc, 'salt')
    ).toBe('legacy.pdf');
  });

  it('falls back to legacy plaintext on a decrypt failure (corrupt/key mismatch)', () => {
    const enc = mockEnc(() => { throw new Error('bad key'); });
    expect(
      decryptOriginalFilename({ originalFilename: 'legacy.pdf', originalFilenameEncrypted: 'CT' }, enc, 'salt')
    ).toBe('legacy.pdf');
  });

  it("returns '' when neither column is set", () => {
    const enc = mockEnc(() => '');
    expect(
      decryptOriginalFilename({ originalFilename: null, originalFilenameEncrypted: null }, enc, 'salt')
    ).toBe('');
  });
});

describe('decryptOriginalFilename (L24) — real encrypt→decrypt round-trip', () => {
  let getEnc: typeof getEncryptionService;
  const SALT = 'a'.repeat(64); // 32-byte hex user salt

  beforeAll(async () => {
    process.env.PHI_ENCRYPTION_KEY =
      'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    ({ getEncryptionService: getEnc } = await import('../services/encryption.js'));
  });

  it('recovers the original PHI-bearing filename written by the upload path', () => {
    const enc = getEnc();
    const original = 'Jane Doe MRI 2026.pdf';
    const ciphertext = enc.encrypt(original, SALT); // what the upload controller stores
    expect(ciphertext).not.toContain(original); // genuinely encrypted at rest
    const resolved = decryptOriginalFilename(
      { originalFilename: null, originalFilenameEncrypted: ciphertext },
      enc,
      SALT
    );
    expect(resolved).toBe(original);
  });
});
