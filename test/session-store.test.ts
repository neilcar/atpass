import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "../src/core/node/config.js";
import type { SecretStore, StoredSession } from "../src/core/node/config.js";

const sample: StoredSession = {
  service: "https://pds.example",
  session: { did: "did:plc:faketest", handle: "alice.test", accessJwt: "access", refreshJwt: "refresh", active: true },
};

// Empty slots return null, as the real @napi-rs/keyring binding does.
function fakeKeyring(opts: { failWith?: Error } = {}) {
  let value: string | null = null;
  const store: SecretStore & { value(): string | null } = {
    async get() {
      if (opts.failWith) throw opts.failWith;
      return value;
    },
    async set(v) {
      if (opts.failWith) throw opts.failWith;
      value = v;
    },
    async delete() {
      if (opts.failWith) throw opts.failWith;
      value = null;
    },
    value: () => value,
  };
  return store;
}

async function setup(keyring: SecretStore | null) {
  const dir = await mkdtemp(join(tmpdir(), "atpass-session-"));
  const sessionFile = join(dir, ".atpass", "session.json");
  const warnings: string[] = [];
  const store = createSessionStore({ openKeyring: async () => keyring, sessionFile, warn: (m) => warnings.push(m) });
  return { ...store, sessionFile, warnings, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const exists = (p: string) => stat(p).then(() => true, () => false);

test("with a keyring, the session lives there and never touches disk", async () => {
  const keyring = fakeKeyring();
  const s = await setup(keyring);
  await s.saveSession(sample);
  assert.deepEqual(JSON.parse(keyring.value()!), sample);
  assert.equal(await exists(s.sessionFile), false);
  assert.deepEqual(await s.loadSession(), sample);
  await s.clearSession();
  assert.equal(keyring.value(), null);
  assert.equal(await s.loadSession(), null);
  assert.deepEqual(s.warnings, []);
  await s.cleanup();
});

test("a session file from an older version is moved into the keyring on first read", async () => {
  const keyring = fakeKeyring();
  const s = await setup(keyring);
  await s.saveSession(sample); // lands in keyring; now simulate the legacy layout instead
  await keyring.delete();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(s.sessionFile, ".."), { recursive: true });
  await writeFile(s.sessionFile, JSON.stringify(sample), { mode: 0o600 });

  assert.deepEqual(await s.loadSession(), sample);
  assert.deepEqual(JSON.parse(keyring.value()!), sample);
  assert.equal(await exists(s.sessionFile), false);
  await s.cleanup();
});

for (const [label, keyring] of [
  ["no keyring binding", null],
  ["a keyring that errors (e.g. no Secret Service)", fakeKeyring({ failWith: new Error("no secret service") })],
] as const) {
  test(`with ${label}, it falls back to a 0600 file and warns once`, async () => {
    const s = await setup(keyring);
    await s.saveSession(sample);
    await s.saveSession(sample);
    assert.deepEqual(JSON.parse(await readFile(s.sessionFile, "utf8")), sample);
    if (process.platform !== "win32") assert.equal((await stat(s.sessionFile)).mode & 0o777, 0o600);
    assert.deepEqual(await s.loadSession(), sample);
    assert.equal(s.warnings.length, 1);
    await s.clearSession();
    assert.equal(await exists(s.sessionFile), false);
    assert.equal(await s.loadSession(), null);
    await s.cleanup();
  });
}
