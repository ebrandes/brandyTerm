// Electron safeStorage as a Cipher. Kept apart from secrets.ts so that module loads under plain node (tests).
import { safeStorage } from 'electron'
import type { Cipher } from './secrets.ts'

export const safeCipher: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: s => safeStorage.encryptString(s).toString('base64'),
  decrypt: b64 => safeStorage.decryptString(Buffer.from(b64, 'base64')),
}
