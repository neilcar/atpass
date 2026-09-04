import { AtpAgent } from "@atproto/api";
import type { AtpSessionData } from "@atproto/api";

export const DEFAULT_SERVICE = "https://bsky.social";

const STORAGE_KEY = "atpass.session";

interface StoredSession {
  service: string;
  session: AtpSessionData;
}

async function loadStored(): Promise<StoredSession | null> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as StoredSession | undefined) ?? null;
}

async function saveStored(stored: StoredSession): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: stored });
}

async function clearStored(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
}

let agentSingleton: AtpAgent | null = null;

/** Get an AtpAgent, resuming a persisted session if one exists. Returns null if not logged in. */
export async function getAgent(): Promise<AtpAgent | null> {
  if (agentSingleton) return agentSingleton;

  const stored = await loadStored();
  if (!stored) return null;

  const agent = new AtpAgent({
    service: stored.service,
    persistSession: (_evt, session) => {
      if (session) {
        saveStored({ service: stored.service, session }).catch(() => {});
      } else {
        clearStored().catch(() => {});
      }
    },
  });
  try {
    await agent.resumeSession(stored.session);
  } catch {
    await clearStored();
    return null;
  }
  agentSingleton = agent;
  return agent;
}

export async function login(service: string, identifier: string, appPassword: string): Promise<AtpAgent> {
  const agent = new AtpAgent({
    service,
    persistSession: (_evt, session) => {
      if (session) saveStored({ service, session }).catch(() => {});
    },
  });
  await agent.login({ identifier, password: appPassword });
  agentSingleton = agent;
  return agent;
}

export async function logout(): Promise<void> {
  agentSingleton = null;
  await clearStored();
}
