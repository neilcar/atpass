import { AtpAgent } from "@atproto/api";
import type { AtpSessionData } from "@atproto/api";
import { loadSession, saveSession, clearSession } from "./config.js";

export const DEFAULT_SERVICE = "https://bsky.social";

export const META_COLLECTION = "xyz.atpass.vault.meta";
export const META_RKEY = "self";
export const ITEM_COLLECTION = "xyz.atpass.vault.item";

let agentSingleton: AtpAgent | null = null;

/** Get an AtpAgent, resuming a persisted session if one exists. Throws if not logged in. */
export async function getAgent(): Promise<AtpAgent> {
  if (agentSingleton) return agentSingleton;

  const stored = await loadSession();
  if (!stored) {
    throw new Error("Not logged in. Run `atpass login <handle>` first.");
  }

  const agent = new AtpAgent({
    service: stored.service,
    persistSession: async (_evt, session) => {
      if (session) {
        await saveSession({ service: stored.service, session });
      } else {
        await clearSession();
      }
    },
  });
  await agent.resumeSession(stored.session);
  agentSingleton = agent;
  return agent;
}

export async function login(
  service: string,
  identifier: string,
  appPassword: string,
): Promise<AtpAgent> {
  const agent = new AtpAgent({
    service,
    persistSession: async (_evt, session) => {
      if (session) {
        await saveSession({ service, session });
      }
    },
  });
  await agent.login({ identifier, password: appPassword });
  agentSingleton = agent;
  return agent;
}

export async function logout(): Promise<void> {
  agentSingleton = null;
  await clearSession();
}

export interface VaultMetaRecord {
  $type: string;
  kdf: "argon2id";
  salt: string;
  kdfParams: { memoryCost: number; timeCost: number; parallelism: number };
  verifier: string;
  verifierIv: string;
  createdAt: string;
}

export async function getVaultMeta(agent: AtpAgent): Promise<VaultMetaRecord | null> {
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: agent.assertDid,
      collection: META_COLLECTION,
      rkey: META_RKEY,
    });
    return res.data.value as unknown as VaultMetaRecord;
  } catch (err: any) {
    if (err?.error === "RecordNotFound" || /could not locate record/i.test(err?.message ?? "")) {
      return null;
    }
    throw err;
  }
}

export async function putVaultMeta(agent: AtpAgent, meta: Omit<VaultMetaRecord, "$type">): Promise<void> {
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

export async function putItemRecord(agent: AtpAgent, rkey: string, record: Omit<ItemRecord, "$type">): Promise<void> {
  await agent.com.atproto.repo.putRecord({
    repo: agent.assertDid,
    collection: ITEM_COLLECTION,
    rkey,
    record: { $type: ITEM_COLLECTION, ...record },
    validate: false,
  });
}

export async function getItemRecord(agent: AtpAgent, rkey: string): Promise<ItemRecord | null> {
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: agent.assertDid,
      collection: ITEM_COLLECTION,
      rkey,
    });
    return res.data.value as unknown as ItemRecord;
  } catch (err: any) {
    if (err?.error === "RecordNotFound" || /could not locate record/i.test(err?.message ?? "")) {
      return null;
    }
    throw err;
  }
}

export async function deleteItemRecord(agent: AtpAgent, rkey: string): Promise<void> {
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

export async function listItemRecords(agent: AtpAgent): Promise<ListedItem[]> {
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
