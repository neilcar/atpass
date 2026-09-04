import type { Agent } from "@atproto/api";
import {
  getVaultMeta,
  putVaultMeta,
  getItemRecord,
  putItemRecord,
  deleteItemRecord,
  listItemRecords,
  META_COLLECTION,
  ITEM_COLLECTION,
} from "./records.js";
import type { CryptoAdapter, ItemPayload } from "./types.js";
import { KDF_DEFAULTS } from "./types.js";

export class WrongMasterPasswordError extends Error {
  constructor() {
    super("Incorrect master password.");
  }
}

export class VaultNotInitializedError extends Error {
  constructor() {
    super("No vault found for this account yet.");
  }
}

export class VaultAlreadyExistsError extends Error {
  constructor() {
    super("A vault already exists for this account. Unlock it with your master password instead.");
  }
}

export class ItemNotFoundError extends Error {
  constructor(name: string) {
    super(`No vault item named "${name}".`);
  }
}

export interface VaultListEntry {
  title: string;
  username?: string;
  url?: string;
  updatedAt: string;
}

/** Vault operations bound to a specific crypto backend (Node or browser). Contains no I/O beyond `agent` calls. */
export function createVault(crypto: CryptoAdapter) {
  function itemAad(rkey: string): string {
    return `${ITEM_COLLECTION}/${rkey}`;
  }

  async function hasVault(agent: Agent): Promise<boolean> {
    return (await getVaultMeta(agent)) !== null;
  }

  /** Create the vault meta record for a fresh account. Throws VaultAlreadyExistsError if one exists. */
  async function initVault(agent: Agent, masterPassword: string): Promise<void> {
    const existing = await getVaultMeta(agent);
    if (existing) throw new VaultAlreadyExistsError();
    const salt = crypto.newSalt();
    const key = await crypto.deriveVaultKey(masterPassword, salt, KDF_DEFAULTS);
    const { iv, ciphertext } = await crypto.makeVerifier(key);
    await putVaultMeta(agent, {
      kdf: "argon2id",
      salt: btoaBytes(salt),
      kdfParams: { ...KDF_DEFAULTS },
      verifier: ciphertext,
      verifierIv: iv,
      createdAt: new Date().toISOString(),
    });
  }

  /** Derive and verify the vault key for an existing vault. Throws WrongMasterPasswordError / VaultNotInitializedError. */
  async function unlockVault(agent: Agent, masterPassword: string): Promise<Uint8Array> {
    const meta = await getVaultMeta(agent);
    if (!meta) throw new VaultNotInitializedError();
    const salt = atobBytes(meta.salt);
    const key = await crypto.deriveVaultKey(masterPassword, salt, meta.kdfParams);
    if (!(await crypto.checkVerifier(key, meta.verifierIv, meta.verifier))) {
      throw new WrongMasterPasswordError();
    }
    return key;
  }

  async function addItem(agent: Agent, key: Uint8Array, payload: ItemPayload): Promise<void> {
    const rkey = await crypto.rkeyForName(payload.title);
    const existing = await getItemRecord(agent, rkey);
    const { iv, ciphertext } = await crypto.encryptItem(key, payload, itemAad(rkey));
    const now = new Date().toISOString();
    await putItemRecord(agent, rkey, {
      alg: "AES-256-GCM",
      iv,
      ciphertext,
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing ? now : undefined,
    });
  }

  async function getItem(agent: Agent, key: Uint8Array, name: string): Promise<ItemPayload> {
    const rkey = await crypto.rkeyForName(name);
    const record = await getItemRecord(agent, rkey);
    if (!record) throw new ItemNotFoundError(name);
    return crypto.decryptItem<ItemPayload>(key, record.iv, record.ciphertext, itemAad(rkey));
  }

  async function removeItem(agent: Agent, name: string): Promise<void> {
    const rkey = await crypto.rkeyForName(name);
    const existing = await getItemRecord(agent, rkey);
    if (!existing) throw new ItemNotFoundError(name);
    await deleteItemRecord(agent, rkey);
  }

  async function listItems(agent: Agent, key: Uint8Array): Promise<VaultListEntry[]> {
    const records = await listItemRecords(agent);
    const out: VaultListEntry[] = [];
    for (const { rkey, record } of records) {
      try {
        const payload = await crypto.decryptItem<ItemPayload>(key, record.iv, record.ciphertext, itemAad(rkey));
        out.push({
          title: payload.title,
          username: payload.username,
          url: payload.url,
          updatedAt: record.updatedAt ?? record.createdAt,
        });
      } catch {
        out.push({ title: `<undecryptable item ${rkey}>`, updatedAt: record.updatedAt ?? record.createdAt });
      }
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  return { hasVault, initVault, unlockVault, addItem, getItem, removeItem, listItems };
}

export type Vault = ReturnType<typeof createVault>;

// btoa/atob (not Buffer) so this module stays bundlable for the browser as-is.
function btoaBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function atobBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export { META_COLLECTION, ITEM_COLLECTION };
