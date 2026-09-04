import type { Agent } from "@atproto/api";

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
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: agent.assertDid,
      collection: META_COLLECTION,
      rkey: META_RKEY,
    });
    return res.data.value as unknown as VaultMetaRecord;
  } catch (err: any) {
    if (isNotFound(err)) return null;
    throw err;
  }
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
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: agent.assertDid,
      collection: ITEM_COLLECTION,
      rkey,
    });
    return res.data.value as unknown as ItemRecord;
  } catch (err: any) {
    if (isNotFound(err)) return null;
    throw err;
  }
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
      items.push({ rkey, uri: r.uri, record: r.value as unknown as ItemRecord });
    }
    cursor = res.data.cursor;
  } while (cursor);
  return items;
}
