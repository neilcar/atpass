import { randomBytes, randomInt, createCipheriv, createDecipheriv, timingSafeEqual, createHash } from "node:crypto";
import { hashRaw as argon2HashRaw, Algorithm } from "@node-rs/argon2";

export const KDF_DEFAULTS = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export interface KdfParams {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM standard nonce size
const VERIFIER_PLAINTEXT = "xyz.atpass.vault.verifier.v1";

export function newSalt(): Buffer {
  return randomBytes(16);
}

/** Derive the 32-byte vault key from the master password using Argon2id. */
export async function deriveVaultKey(
  masterPassword: string,
  salt: Buffer,
  params: KdfParams = KDF_DEFAULTS,
): Promise<Buffer> {
  return argon2HashRaw(masterPassword, {
    salt,
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
    outputLen: KEY_LEN,
    algorithm: Algorithm.Argon2id,
  });
}

/** Encrypt an arbitrary JSON-serializable payload. `aad` binds the ciphertext to its record (e.g. the rkey). */
export function encryptItem(key: Buffer, payload: unknown, aad: string): { iv: string; ciphertext: string } {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
  };
}

/** Decrypt a payload produced by encryptItem. Throws if the master password / key is wrong or data was tampered with. */
export function decryptItem<T = unknown>(key: Buffer, iv: string, ciphertext: string, aad: string): T {
  const ivBuf = Buffer.from(iv, "base64");
  const blob = Buffer.from(ciphertext, "base64");
  const authTag = blob.subarray(blob.length - 16);
  const encrypted = blob.subarray(0, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, ivBuf);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

/** Build the verifier blob stored in the vault meta record. */
export function makeVerifier(key: Buffer): { iv: string; ciphertext: string } {
  return encryptItem(key, VERIFIER_PLAINTEXT, "xyz.atpass.vault.meta/self");
}

/** Returns true iff `key` correctly decrypts the stored verifier. Never throws on a wrong password. */
export function checkVerifier(key: Buffer, iv: string, ciphertext: string): boolean {
  try {
    const decoded = decryptItem<string>(key, iv, ciphertext, "xyz.atpass.vault.meta/self");
    const a = Buffer.from(decoded, "utf8");
    const b = Buffer.from(VERIFIER_PLAINTEXT, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Deterministic, non-reversible record key for an item name: sha256(name) truncated to hex, so items can be
 * fetched directly by name without listing/decrypting the whole vault, without storing the name in plaintext. */
export function rkeyForName(name: string): string {
  return createHash("sha256").update(name.trim().toLowerCase(), "utf8").digest("hex").slice(0, 32);
}

export interface GeneratePasswordOptions {
  length?: number;
  upper?: boolean;
  lower?: boolean;
  digits?: boolean;
  symbols?: boolean;
  excludeAmbiguous?: boolean;
}

const AMBIGUOUS = new Set(["l", "I", "1", "O", "0", "o"]);

export function generatePassword(opts: GeneratePasswordOptions = {}): string {
  const { length = 20, upper = true, lower = true, digits = true, symbols = true, excludeAmbiguous = false } = opts;
  let charset = "";
  if (upper) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (lower) charset += "abcdefghijklmnopqrstuvwxyz";
  if (digits) charset += "0123456789";
  if (symbols) charset += "!@#$%^&*()-_=+[]{}<>?";
  if (excludeAmbiguous) {
    charset = Array.from(charset)
      .filter((c) => !AMBIGUOUS.has(c))
      .join("");
  }
  if (!charset) throw new Error("generatePassword: no character classes selected");
  const chars: string[] = [];
  for (let i = 0; i < length; i++) {
    chars.push(charset[randomInt(charset.length)]);
  }
  return chars.join("");
}
