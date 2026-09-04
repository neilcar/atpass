import { AtpAgent } from "@atproto/api";
import { loadSession, saveSession, clearSession } from "./config.js";

export const DEFAULT_SERVICE = "https://bsky.social";

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

export async function login(service: string, identifier: string, appPassword: string): Promise<AtpAgent> {
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
