// keyVault — encrypt API keys at rest in ~/.ares/ui.json.
//
// API keys used to sit in ui.json as plaintext — grep-able by anything with
// read access to the home dir. This wraps them in AES-256-GCM under a
// machine-local secret (~/.ares/.keysecret, 0600). It is NOT a hardware
// keychain, but it removes plaintext-at-rest and keeps the keys out of casual
// view, backups, and screen-shares.
//
// Back-compat is absolute: a value that isn't an `enc:v1:` token is returned
// untouched (existing plaintext keys keep working and get encrypted on the next
// save), and if the secret can't be created/read we silently fall back to
// plaintext rather than ever locking the owner out of their own keys.

import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import path from "node:path";
import { aresHome } from "@ares/core";

const PREFIX = "enc:v1:";
let keyPromise: Promise<Buffer | null> | null = null;

async function secretKey(): Promise<Buffer | null> {
  keyPromise ??= (async () => {
    try {
      const file = path.join(aresHome(), ".keysecret");
      try {
        const existing = await readFile(file);
        if (existing.length >= 32) return existing.subarray(0, 32);
      } catch {
        // no secret yet — create one
      }
      const key = randomBytes(32);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, key, { mode: 0o600 });
      try {
        await chmod(file, 0o600);
      } catch {
        // chmod is a no-op / unsupported on some Windows filesystems — fine
      }
      return key;
    } catch {
      return null; // can't persist a secret → fall back to plaintext, never break
    }
  })();
  return keyPromise;
}

/** Encrypt a secret for storage. Idempotent: already-encrypted or empty values
 *  pass through. Falls back to plaintext if no machine secret is available. */
export async function encryptSecret(plain: string | undefined): Promise<string | undefined> {
  if (!plain || plain.startsWith(PREFIX)) return plain;
  const key = await secretKey();
  if (!key) return plain;
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
  } catch {
    return plain;
  }
}

/** Decrypt a stored secret. Plaintext / non-token values pass through unchanged
 *  (back-compat), as does anything that fails to decrypt. */
export async function decryptSecret(token: string | undefined): Promise<string | undefined> {
  if (!token || !token.startsWith(PREFIX)) return token;
  const key = await secretKey();
  if (!key) return token;
  try {
    const raw = Buffer.from(token.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return token;
  }
}
