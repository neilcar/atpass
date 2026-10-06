import type { Agent } from "@atproto/api";
import { VaultMetaRecordSchema, ItemRecordSchema, parseRecord } from "./schemas.js";

export const META_COLLECTION = "xyz.atpass.vault.meta";
export const META_RKEY = "self";
export const ITEM_COLLECTION = "xyz.atpass.vault.item";

export interface VaultMetaRecord {
  $type: string;
  kdf: "argon2id";
  salt: string;
  kdfParams: { memoryCost: number; timeCost: number; parallelism: number };
  verifier: string;
  verifierIv: string;
  createdAt: string;
}

function isNotFound(err: any): boolean {
  return err?.error === "RecordNotFound" || /could not locate record/i.test(err?.message ?? "");
}

export async function getVaultMeta(agent: Agent): Promise<VaultMetaRecord | null> {
  let value: unknown;
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: agent.assertDid,
      collection: META_COLLECTION,
      rkey: META_RKEY,
    });
    value = res.data.value;
  } catch (err: any) {
    if (isNotFound(err)) return null;
    throw err;
  }
  return parseRecord(VaultMetaRecordSchema, value, "Failed to validate vault metadata from PDS");
}

export async function putVaultMeta(agent: Agent, meta: Omit<VaultMetaRecord, "$type">): Promise<void> {
  await agent.com.atproto.repo.putRecord({
    repo: agent.assertDid,
    collection: META_COLLECTION,
    rkey: META_RKEY,
    record: { $type: META_COLLECTION, ...meta },
    validate: false,
  });
}

export interface ItemRecord {
  $type: string;
  alg: "AES-256-GCM";
  iv: string;
  ciphertext: string;
  createdAt: string;
  updatedAt?: string;
}

export async function putItemRecord(agent: Agent, rkey: string, record: Omit<ItemRecord, "$type">): Promise<void> {
  await agent.com.atproto.repo.putRecord({
    repo: agent.assertDid,
    collection: ITEM_COLLECTION,
    rkey,
    record: { $type: ITEM_COLLECTION, ...record },
    validate: false,
  });
}

export async function getItemRecord(agent: Agent, rkey: string): Promise<ItemRecord | null> {
  let value: unknown;
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: agent.assertDid,
      collection: ITEM_COLLECTION,
      rkey,
    });
    value = res.data.value;
  } catch (err: any) {
    if (isNotFound(err)) return null;
    throw err;
  }
  return parseRecord(ItemRecordSchema, value, "Failed to validate vault item from PDS");
}

export async function deleteItemRecord(agent: Agent, rkey: string): Promise<void> {
  await agent.com.atproto.repo.deleteRecord({
    repo: agent.assertDid,
    collection: ITEM_COLLECTION,
    rkey,
  });
}

export interface ListedItem {
  rkey: string;
  uri: string;
  record: ItemRecord;
}

export async function listItemRecords(agent: Agent): Promise<ListedItem[]> {
  const items: ListedItem[] = [];
  let cursor: string | undefined;
  do {
    const res = await agent.com.atproto.repo.listRecords({
      repo: agent.assertDid,
      collection: ITEM_COLLECTION,
      limit: 100,
      cursor,
    });
    for (const r of res.data.records) {
      const rkey = r.uri.split("/").pop()!;
      // Throws on the first malformed record rather than skipping it, so corruption or tampering isn't silently hidden.
      items.push({ rkey, uri: r.uri, record: parseRecord(ItemRecordSchema, r.value, `Failed to validate vault item ${rkey} from PDS`) });
    }
    cursor = res.data.cursor;
  } while (cursor);
  return items;
}
