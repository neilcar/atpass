import { AtpAgent } from "@atproto/api";
import type { AtpSessionData } from "@atproto/api";

export const DEFAULT_SERVICE = "https://bsky.social";

const STORAGE_KEY = "atpass.session";

interface StoredSession {
  service: string;
  session: AtpSessionData;
}

function loadStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveStored(stored: StoredSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function clearStored(): void {
  localStorage.removeItem(STORAGE_KEY);
}

let agentSingleton: AtpAgent | null = null;

/** Get an AtpAgent, resuming a persisted browser session if one exists. Returns null if not logged in. */
export async function getAgent(): Promise<AtpAgent | null> {
  if (agentSingleton) return agentSingleton;

  const stored = loadStored();
  if (!stored) return null;

  const agent = new AtpAgent({
    service: stored.service,
    persistSession: (_evt, session) => {
      if (session) {
        saveStored({ service: stored.service, session });
      } else {
        clearStored();
      }
    },
  });
  try {
    await agent.resumeSession(stored.session);
  } catch {
    clearStored();
    return null;
  }
  agentSingleton = agent;
  return agent;
}

export async function login(service: string, identifier: string, appPassword: string): Promise<AtpAgent> {
  const agent = new AtpAgent({
    service,
    persistSession: (_evt, session) => {
      if (session) saveStored({ service, session });
    },
  });
  await agent.login({ identifier, password: appPassword });
  agentSingleton = agent;
  return agent;
}

export function logout(): void {
  agentSingleton = null;
  clearStored();
}
