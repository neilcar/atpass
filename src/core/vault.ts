import type { AtpAgent } from "@atproto/api";
import {
  getVaultMeta,
  putVaultMeta,
  getItemRecord,
  putItemRecord,
  deleteItemRecord,
  listItemRecords,
  META_COLLECTION,
  ITEM_COLLECTION,
} from "./atproto.js";
import {
  KDF_DEFAULTS,
  newSalt,
  deriveVaultKey,
  encryptItem,
  decryptItem,
  makeVerifier,
  checkVerifier,
  rkeyForName,
} from "./crypto.js";

export interface ItemPayload {
  title: string;
  username?: string;
  password: string;
  url?: string;
  notes?: string;
}

export class WrongMasterPasswordError extends Error {
  constructor() {
    super("Incorrect master password.");
  }
}

export class VaultNotInitializedError extends Error {
  constructor() {
    super("No vault found for this account yet. Run `atpass init` to create one.");
  }
}

export class ItemNotFoundError extends Error {
  constructor(name: string) {
    super(`No vault item named "${name}".`);
  }
}

/** Create the vault meta record for a fresh account. Fails loudly if one already exists. */
export async function initVault(agent: AtpAgent, masterPassword: string): Promise<void> {
  const existing = await getVaultMeta(agent);
  if (existing) {
    throw new Error("A vault already exists for this account. Use `atpass unlock` to verify your master password instead.");
  }
  const salt = newSalt();
  const key = await deriveVaultKey(masterPassword, salt, KDF_DEFAULTS);
  const { iv, ciphertext } = makeVerifier(key);
  await putVaultMeta(agent, {
    kdf: "argon2id",
    salt: salt.toString("base64"),
    kdfParams: { ...KDF_DEFAULTS },
    verifier: ciphertext,
    verifierIv: iv,
    createdAt: new Date().toISOString(),
  });
}

/** Derive and verify the vault key for an existing vault. Throws WrongMasterPasswordError / VaultNotInitializedError. */
export async function unlockVault(agent: AtpAgent, masterPassword: string): Promise<Buffer> {
  const meta = await getVaultMeta(agent);
  if (!meta) throw new VaultNotInitializedError();
  const salt = Buffer.from(meta.salt, "base64");
  const key = await deriveVaultKey(masterPassword, salt, meta.kdfParams);
  if (!checkVerifier(key, meta.verifierIv, meta.verifier)) {
    throw new WrongMasterPasswordError();
  }
  return key;
}

function itemAad(rkey: string): string {
  return `${ITEM_COLLECTION}/${rkey}`;
}

export async function addItem(agent: AtpAgent, key: Buffer, payload: ItemPayload): Promise<void> {
  const rkey = rkeyForName(payload.title);
  const existing = await getItemRecord(agent, rkey);
  const { iv, ciphertext } = encryptItem(key, payload, itemAad(rkey));
  const now = new Date().toISOString();
  await putItemRecord(agent, rkey, {
    alg: "AES-256-GCM",
    iv,
    ciphertext,
    createdAt: existing?.createdAt ?? now,
    updatedAt: existing ? now : undefined,
  });
}

export async function getItem(agent: AtpAgent, key: Buffer, name: string): Promise<ItemPayload> {
  const rkey = rkeyForName(name);
  const record = await getItemRecord(agent, rkey);
  if (!record) throw new ItemNotFoundError(name);
  return decryptItem<ItemPayload>(key, record.iv, record.ciphertext, itemAad(rkey));
}

export async function removeItem(agent: AtpAgent, name: string): Promise<void> {
  const rkey = rkeyForName(name);
  const existing = await getItemRecord(agent, rkey);
  if (!existing) throw new ItemNotFoundError(name);
  await deleteItemRecord(agent, rkey);
}

export interface VaultListEntry {
  title: string;
  username?: string;
  url?: string;
  updatedAt: string;
}

export async function listItems(agent: AtpAgent, key: Buffer): Promise<VaultListEntry[]> {
  const records = await listItemRecords(agent);
  const out: VaultListEntry[] = [];
  for (const { rkey, record } of records) {
    try {
      const payload = decryptItem<ItemPayload>(key, record.iv, record.ciphertext, itemAad(rkey));
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

export { META_COLLECTION, ITEM_COLLECTION };
