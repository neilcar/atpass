import { AtpAgent } from "@atproto/api";
import type { AtpSessionData } from "@atproto/api";

export const DEFAULT_SERVICE = "https://bsky.social";

const STORAGE_KEY = "atpass.session";

interface StoredSession {
  service: string;
  session: AtpSessionData;
}

// sessionStorage, not localStorage: the token is scoped to this tab and gone when it closes, so it doesn't sit on disk
// for later reading. Same-origin script running in the tab can still read it; the CSP is what guards against that.
function loadStored(): StoredSession | null {
  migrateFromLocalStorage();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveStored(stored: StoredSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function clearStored(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
}

/** Older versions kept the session in localStorage: move it into this tab's sessionStorage and delete the persistent copy. */
function migrateFromLocalStorage(): void {
  try {
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy === null) return;
    localStorage.removeItem(STORAGE_KEY);
    if (sessionStorage.getItem(STORAGE_KEY) === null) sessionStorage.setItem(STORAGE_KEY, legacy);
  } catch {
    // Storage unavailable (e.g. blocked by the browser): nothing to migrate.
  }
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
