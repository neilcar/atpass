import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises";
import type { AtpSessionData } from "@atproto/api";

export const CONFIG_DIR = join(homedir(), ".atpass");
const SESSION_FILE = join(CONFIG_DIR, "session.json");
const KEYRING_SERVICE = "atpass";
const KEYRING_ACCOUNT = "session";

export interface StoredSession {
  service: string;
  session: AtpSessionData;
}

/** One secret slot in the OS credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service). */
export interface SecretStore {
  /** Resolves null/undefined when nothing is stored (the binding returns null despite its typings). */
  get(): Promise<string | null | undefined>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}

/**
 * Open the OS keyring entry for the session, or null if the native binding can't load on this platform. Loaded
 * lazily so a missing binding degrades to the file fallback instead of breaking the whole CLI at startup.
 */
async function openOsKeyring(): Promise<SecretStore | null> {
  let AsyncEntry: typeof import("@napi-rs/keyring").AsyncEntry;
  try {
    ({ AsyncEntry } = await import("@napi-rs/keyring"));
  } catch {
    return null;
  }
  const entry = new AsyncEntry(KEYRING_SERVICE, KEYRING_ACCOUNT);
  return {
    get: () => entry.getPassword(),
    set: (value) => entry.setPassword(value),
    delete: async () => {
      await entry.deletePassword();
    },
  };
}

export interface SessionStoreOptions {
  /** Returns the keyring slot, or null when there's no usable keyring binding. */
  openKeyring: () => Promise<SecretStore | null>;
  /** Plaintext fallback (mode 0600), used only when the keyring can't be used, e.g. headless Linux with no Secret Service. */
  sessionFile: string;
  warn: (message: string) => void;
}

/**
 * Session persistence: the atproto session (a bearer credential for the whole repo) goes in the OS keyring. If the
 * keyring is unavailable it falls back to the 0600 file, with a warning, rather than leaving the CLI unusable. A file
 * left by an older version is moved into the keyring the next time the session is read.
 */
export function createSessionStore({ openKeyring, sessionFile, warn }: SessionStoreOptions) {
  let warned = false;
  function warnFallback(err: unknown): void {
    if (warned) return;
    warned = true;
    const reason = err instanceof Error ? err.message : String(err);
    warn(`OS keyring unavailable (${reason}); keeping the atproto session in ${sessionFile} (readable only by you).`);
  }

  async function readFileSession(): Promise<string | null> {
    try {
      return await readFile(sessionFile, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }
  }

  async function writeFileSession(json: string): Promise<void> {
    await mkdir(dirname(sessionFile), { recursive: true, mode: 0o700 });
    await writeFile(sessionFile, json, { encoding: "utf8", mode: 0o600 });
    await chmod(sessionFile, 0o600);
  }

  async function removeFileSession(): Promise<void> {
    await rm(sessionFile, { force: true });
  }

  async function saveSession(stored: StoredSession): Promise<void> {
    const json = JSON.stringify(stored);
    const keyring = await openKeyring();
    if (keyring) {
      try {
        await keyring.set(json);
        await removeFileSession();
        return;
      } catch (err) {
        warnFallback(err);
      }
    } else {
      warnFallback(new Error("no keyring binding for this platform"));
    }
    await writeFileSession(json);
  }

  async function loadSession(): Promise<StoredSession | null> {
    const keyring = await openKeyring();
    if (keyring) {
      try {
        const value = await keyring.get();
        if (value != null) return JSON.parse(value) as StoredSession;
      } catch (err) {
        warnFallback(err);
      }
    }
    const raw = await readFileSession();
    if (raw === null) return null;
    const stored = JSON.parse(raw) as StoredSession;
    if (keyring) {
      try {
        await keyring.set(JSON.stringify(stored));
        await removeFileSession();
      } catch (err) {
        warnFallback(err);
      }
    }
    return stored;
  }

  async function clearSession(): Promise<void> {
    const keyring = await openKeyring();
    if (keyring) {
      try {
        await keyring.delete();
      } catch (err) {
        warnFallback(err);
      }
    }
    await removeFileSession();
  }

  return { saveSession, loadSession, clearSession };
}

let osKeyring: Promise<SecretStore | null> | undefined;

export const { saveSession, loadSession, clearSession } = createSessionStore({
  openKeyring: () => (osKeyring ??= openOsKeyring()),
  sessionFile: SESSION_FILE,
  warn: (message) => console.error(`atpass: ${message}`),
});
