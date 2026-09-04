import { argon2id } from "hash-wasm";
import type { CryptoAdapter, EncryptedBlob, GeneratePasswordOptions, KdfParams } from "../types.js";

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM standard nonce size
const VERIFIER_PLAINTEXT = "xyz.atpass.vault.verifier.v1";
const VERIFIER_AAD = "xyz.atpass.vault.meta/self";

const AMBIGUOUS = new Set(["l", "I", "1", "O", "0", "o"]);

function b64encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveVaultKey(masterPassword: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
  return argon2id({
    password: masterPassword,
    salt,
    iterations: params.timeCost,
    parallelism: params.parallelism,
    memorySize: params.memoryCost,
    hashLength: KEY_LEN,
    outputType: "binary",
  });
}

// crypto.subtle wants BufferSource (ArrayBuffer-backed); our keys/bytes are always
// plain heap-allocated Uint8Arrays, never SharedArrayBuffer-backed, so this cast is safe.
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as Uint8Array<ArrayBuffer>;
}

async function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asBufferSource(key), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptItem(key: Uint8Array, payload: unknown, aad: string): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const cryptoKey = await importAesKey(key);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    cryptoKey,
    plaintext,
  );
  return {
    iv: b64encode(iv),
    ciphertext: b64encode(new Uint8Array(encrypted)),
  };
}

async function decryptItem<T = unknown>(key: Uint8Array, iv: string, ciphertext: string, aad: string): Promise<T> {
  const cryptoKey = await importAesKey(key);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64decode(iv), additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    cryptoKey,
    b64decode(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

async function makeVerifier(key: Uint8Array): Promise<EncryptedBlob> {
  return encryptItem(key, VERIFIER_PLAINTEXT, VERIFIER_AAD);
}

async function checkVerifier(key: Uint8Array, iv: string, ciphertext: string): Promise<boolean> {
  try {
    const decoded = await decryptItem<string>(key, iv, ciphertext, VERIFIER_AAD);
    return decoded === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

async function rkeyForName(name: string): Promise<string> {
  const bytes = new TextEncoder().encode(name.trim().toLowerCase());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
  // Rejection sampling against a 32-bit source to avoid modulo bias.
  const limit = Math.floor(0x100000000 / charset.length) * charset.length;
  const chars: string[] = [];
  const buf = new Uint32Array(1);
  while (chars.length < length) {
    crypto.getRandomValues(buf);
    if (buf[0] >= limit) continue;
    chars.push(charset[buf[0] % charset.length]);
  }
  return chars.join("");
}

export const webCrypto: CryptoAdapter = {
  newSalt: () => crypto.getRandomValues(new Uint8Array(16)),
  deriveVaultKey,
  encryptItem,
  decryptItem,
  makeVerifier,
  checkVerifier,
  rkeyForName,
  generatePassword,
};
