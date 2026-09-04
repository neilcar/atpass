import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises";
import type { AtpSessionData } from "@atproto/api";

export const CONFIG_DIR = join(homedir(), ".atpass");
const SESSION_FILE = join(CONFIG_DIR, "session.json");

export interface StoredSession {
  service: string;
  session: AtpSessionData;
}

async function ensureConfigDir(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export async function saveSession(stored: StoredSession): Promise<void> {
  await ensureConfigDir();
  await writeFile(SESSION_FILE, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
  await chmod(SESSION_FILE, 0o600);
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await readFile(SESSION_FILE, "utf8");
    return JSON.parse(raw) as StoredSession;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await rm(SESSION_FILE);
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
}
