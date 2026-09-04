import { randomBytes, randomInt, createCipheriv, createDecipheriv, timingSafeEqual, createHash } from "node:crypto";
import { hashRaw as argon2HashRaw, Algorithm } from "@node-rs/argon2";
import type { CryptoAdapter, EncryptedBlob, GeneratePasswordOptions, KdfParams } from "../types.js";

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM standard nonce size
const VERIFIER_PLAINTEXT = "xyz.atpass.vault.verifier.v1";
const VERIFIER_AAD = "xyz.atpass.vault.meta/self";

const AMBIGUOUS = new Set(["l", "I", "1", "O", "0", "o"]);

function toBuffer(u: Uint8Array): Buffer {
  return Buffer.isBuffer(u) ? u : Buffer.from(u.buffer, u.byteOffset, u.byteLength);
}

async function deriveVaultKey(masterPassword: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
  return argon2HashRaw(masterPassword, {
    salt: toBuffer(salt),
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
    outputLen: KEY_LEN,
    algorithm: Algorithm.Argon2id,
  });
}

async function encryptItem(key: Uint8Array, payload: unknown, aad: string): Promise<EncryptedBlob> {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", toBuffer(key), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
  };
}

async function decryptItem<T = unknown>(key: Uint8Array, iv: string, ciphertext: string, aad: string): Promise<T> {
  const ivBuf = Buffer.from(iv, "base64");
  const blob = Buffer.from(ciphertext, "base64");
  const authTag = blob.subarray(blob.length - 16);
  const encrypted = blob.subarray(0, blob.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", toBuffer(key), ivBuf);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

async function makeVerifier(key: Uint8Array): Promise<EncryptedBlob> {
  return encryptItem(key, VERIFIER_PLAINTEXT, VERIFIER_AAD);
}

async function checkVerifier(key: Uint8Array, iv: string, ciphertext: string): Promise<boolean> {
  try {
    const decoded = await decryptItem<string>(key, iv, ciphertext, VERIFIER_AAD);
    const a = Buffer.from(decoded, "utf8");
    const b = Buffer.from(VERIFIER_PLAINTEXT, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function rkeyForName(name: string): Promise<string> {
  return createHash("sha256").update(name.trim().toLowerCase(), "utf8").digest("hex").slice(0, 32);
}

function generatePassword(opts: GeneratePasswordOptions = {}): string {
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

export const nodeCrypto: CryptoAdapter = {
  newSalt: () => randomBytes(16),
  deriveVaultKey,
  encryptItem,
  decryptItem,
  makeVerifier,
  checkVerifier,
  rkeyForName,
  generatePassword,
};
