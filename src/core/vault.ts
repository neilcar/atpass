import type { Agent } from "@atproto/api";
import {
  getVaultMeta,
  putVaultMeta,
  putItemRecord,
  deleteItemRecord,
  listItemRecords,
  listItemRecordsAllowingMalformed,
  rekeyItemRecords,
  META_COLLECTION,
  ITEM_COLLECTION,
} from "./records.js";
import type { CryptoAdapter, ItemPayload } from "./types.js";
import { KDF_DEFAULTS, WeakKdfParamsError, assertKdfParams } from "./types.js";
import { SchemaValidationError } from "./schemas.js";
import type { ItemRecord } from "./records.js";
import { accountUserInputs, validatePasswordStrength, WeakMasterPasswordError } from "./passwordValidator.js";

export { WeakKdfParamsError, SchemaValidationError, WeakMasterPasswordError };

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

  interface DecryptedItem {
    rkey: string;
    record: ItemRecord;
    payload: ItemPayload;
  }

  /**
   * Decrypt every item. Record keys are random, so an item can only be found by title by decrypting. Records that are
   * malformed or don't decrypt under this key are returned by rkey in `unreadable` rather than failing the lookup.
   */
  async function decryptAll(agent: Agent, key: Uint8Array): Promise<{ items: DecryptedItem[]; unreadable: string[] }> {
    const items: DecryptedItem[] = [];
    const unreadable: string[] = [];
    for (const { rkey, record } of await listItemRecordsAllowingMalformed(agent)) {
      if (!record) {
        unreadable.push(rkey);
        continue;
      }
      try {
        const payload = await crypto.decryptItem<ItemPayload>(key, record.iv, record.ciphertext, itemAad(rkey));
        items.push({ rkey, record, payload });
      } catch {
        unreadable.push(rkey);
      }
    }
    return { items, unreadable };
  }

  function sameTitle(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  async function findItem(agent: Agent, key: Uint8Array, name: string) {
    const all = await decryptAll(agent, key);
    return { ...all, found: all.items.find((i) => sameTitle(i.payload.title, name)) ?? null };
  }

  /**
   * Move items still stored under the legacy record key (a hash of the title, which let anyone reading the repo test
   * guesses like "does this vault have github.com?") to random record keys. Each batch re-encrypts the items (the
   * record key is bound in as AAD) and creates the new records and deletes the old ones in one atomic commit, so an
   * item is never lost or duplicated. New keys have the same shape as legacy ones, so the repo doesn't reveal which
   * items have moved. Returns how many items were moved.
   */
  async function migrateLegacyItemKeys(agent: Agent, key: Uint8Array): Promise<number> {
    const { items } = await decryptAll(agent, key);
    const legacy: DecryptedItem[] = [];
    for (const item of items) {
      if (item.rkey === (await crypto.rkeyForName(item.payload.title))) legacy.push(item);
    }
    const BATCH = 50; // two writes per item; applyWrites accepts up to 200
    for (let i = 0; i < legacy.length; i += BATCH) {
      const moves = [];
      for (const item of legacy.slice(i, i + BATCH)) {
        const toRkey = crypto.newRecordKey();
        const { iv, ciphertext } = await crypto.encryptItem(key, item.payload, itemAad(toRkey));
        moves.push({
          fromRkey: item.rkey,
          toRkey,
          record: {
            alg: "AES-256-GCM" as const,
            iv,
            ciphertext,
            createdAt: item.record.createdAt,
            updatedAt: item.record.updatedAt,
          },
        });
      }
      await rekeyItemRecords(agent, moves);
    }
    return legacy.length;
  }

  async function hasVault(agent: Agent): Promise<boolean> {
    return (await getVaultMeta(agent)) !== null;
  }

  /**
   * Create the vault meta record for a fresh account. Throws VaultAlreadyExistsError if one exists, or
   * WeakMasterPasswordError if the master password is too guessable — enforced here so every client gets the same check.
   */
  async function initVault(agent: Agent, masterPassword: string): Promise<void> {
    const strength = await validatePasswordStrength(
      masterPassword,
      accountUserInputs(agent.assertDid, (agent as { session?: { handle?: string } }).session?.handle),
    );
    if (!strength.valid) throw new WeakMasterPasswordError(strength.feedback, strength.score);
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

  /**
   * Derive and verify the vault key for an existing vault. Throws WrongMasterPasswordError / VaultNotInitializedError,
   * or WeakKdfParamsError if the meta record's KDF params fall below the minimum (the record is PDS-controlled, so a
   * tampered one could otherwise make key derivation cheap). It rejects rather than substituting defaults, because
   * defaults would derive a different key and be misreported as a wrong password, hiding the tampering.
   */
  async function unlockVault(
    agent: Agent,
    masterPassword: string,
    opts: { onMigrationError?: (err: unknown) => void } = {},
  ): Promise<Uint8Array> {
    const meta = await getVaultMeta(agent);
    if (!meta) throw new VaultNotInitializedError();
    assertKdfParams(meta.kdfParams);
    const salt = atobBytes(meta.salt);
    const key = await crypto.deriveVaultKey(masterPassword, salt, meta.kdfParams);
    if (!(await crypto.checkVerifier(key, meta.verifierIv, meta.verifier))) {
      throw new WrongMasterPasswordError();
    }
    // Lookups work with either key format, so a failed move (e.g. a network error) doesn't fail the unlock; it's
    // reported through onMigrationError and retried at the next unlock.
    await migrateLegacyItemKeys(agent, key).catch((err) => opts.onMigrationError?.(err));
    return key;
  }

  /** Add an item, or update the one with the same title (case/whitespace-insensitive) in place. */
  async function addItem(agent: Agent, key: Uint8Array, payload: ItemPayload): Promise<void> {
    const { found } = await findItem(agent, key, payload.title);
    const rkey = found?.rkey ?? crypto.newRecordKey();
    const { iv, ciphertext } = await crypto.encryptItem(key, payload, itemAad(rkey));
    const now = new Date().toISOString();
    await putItemRecord(agent, rkey, {
      alg: "AES-256-GCM",
      iv,
      ciphertext,
      createdAt: found?.record.createdAt ?? now,
      updatedAt: found ? now : undefined,
    });
  }

  async function getItem(agent: Agent, key: Uint8Array, name: string): Promise<ItemPayload> {
    const { found } = await findItem(agent, key, name);
    if (!found) throw new ItemNotFoundError(name);
    return found.payload;
  }

  /**
   * Delete the item with this title. `name` may also be the record key of a malformed or undecryptable record (as
   * named in the error that listing it raises), so such records can still be removed.
   */
  async function removeItem(agent: Agent, key: Uint8Array, name: string): Promise<void> {
    const { found, unreadable } = await findItem(agent, key, name);
    const rkey = found?.rkey ?? (unreadable.includes(name) ? name : null);
    if (!rkey) throw new ItemNotFoundError(name);
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

  return { hasVault, initVault, unlockVault, addItem, getItem, removeItem, listItems, migrateLegacyItemKeys };
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
