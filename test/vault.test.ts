import { test } from "node:test";
import assert from "node:assert/strict";
import { createVault, WrongMasterPasswordError, WeakKdfParamsError, ItemNotFoundError, SchemaValidationError } from "../src/core/vault.js";
import { nodeCrypto } from "../src/core/node/crypto.js";

/** Minimal in-memory fake of the subset of Agent used by src/core/records.ts. */
function makeFakeAgent() {
  const repo = new Map<string, any>();
  const did = "did:plc:faketest";
  return {
    assertDid: did,
    com: {
      atproto: {
        repo: {
          async getRecord({ collection, rkey }: any) {
            const key = `${collection}/${rkey}`;
            if (!repo.has(key)) {
              const err: any = new Error("Could not locate record");
              err.error = "RecordNotFound";
              throw err;
            }
            return { data: { uri: `at://${did}/${key}`, value: repo.get(key) } };
          },
          async putRecord({ collection, rkey, record }: any) {
            repo.set(`${collection}/${rkey}`, record);
            return { data: { uri: `at://${did}/${collection}/${rkey}`, cid: "bafyfake" } };
          },
          async deleteRecord({ collection, rkey }: any) {
            repo.delete(`${collection}/${rkey}`);
          },
          async applyWrites({ writes }: any) {
            // Atomic like the real PDS: validate every write before applying any.
            for (const w of writes) {
              const key = `${w.collection}/${w.rkey}`;
              if (w.$type.endsWith("#create") && repo.has(key)) throw new Error(`record already exists: ${key}`);
              if (w.$type.endsWith("#delete") && !repo.has(key)) throw new Error(`no record to delete: ${key}`);
            }
            for (const w of writes) {
              const key = `${w.collection}/${w.rkey}`;
              if (w.$type.endsWith("#delete")) repo.delete(key);
              else repo.set(key, w.value);
            }
          },
          async listRecords({ collection }: any) {
            const records = [];
            for (const [key, value] of repo.entries()) {
              if (key.startsWith(collection + "/")) records.push({ uri: `at://${did}/${key}`, cid: "bafyfake", value });
            }
            return { data: { records } };
          },
        },
      },
    },
  } as any;
}

test("full vault lifecycle: init, unlock, add, get, list, update, remove", async () => {
  const vault = createVault(nodeCrypto);
  const agent = makeFakeAgent();

  assert.equal(await vault.hasVault(agent), false);
  await vault.initVault(agent, "correct horse battery staple");
  assert.equal(await vault.hasVault(agent), true);

  await assert.rejects(() => vault.unlockVault(agent, "wrong password"), WrongMasterPasswordError);

  const key = await vault.unlockVault(agent, "correct horse battery staple");

  await vault.addItem(agent, key, { title: "GitHub.com", username: "alice", password: "hunter2", url: "https://github.com" });
  await vault.addItem(agent, key, { title: "example.com", username: "bob", password: "s3cret" });

  // Lookup is case/whitespace-insensitive since it's keyed by a normalized name hash.
  const item = await vault.getItem(agent, key, "github.com");
  assert.equal(item.password, "hunter2");
  assert.equal(item.username, "alice");

  await assert.rejects(() => vault.getItem(agent, key, "nonexistent.com"), ItemNotFoundError);

  const list = await vault.listItems(agent, key);
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((i) => i.title).sort(),
    ["GitHub.com", "example.com"],
  );

  // Adding again under the same title updates the existing record rather than duplicating it.
  await vault.addItem(agent, key, { title: "GitHub.com", username: "alice2", password: "newpass" });
  const updated = await vault.getItem(agent, key, "GitHub.com");
  assert.equal(updated.password, "newpass");
  assert.equal(updated.username, "alice2");
  assert.equal((await vault.listItems(agent, key)).length, 2);

  await vault.removeItem(agent, key, "example.com");
  assert.equal((await vault.listItems(agent, key)).length, 1);
});

test("unlockVault rejects a meta record whose KDF params were weakened, before deriving anything", async () => {
  let deriveCalls = 0;
  const vault = createVault({
    ...nodeCrypto,
    deriveVaultKey: (...args) => {
      deriveCalls++;
      return nodeCrypto.deriveVaultKey(...args);
    },
  });
  const agent = makeFakeAgent();
  await vault.initVault(agent, "correct horse battery staple");

  // Simulate a malicious PDS rewriting the record to make key derivation cheap.
  const repo = { repo: agent.assertDid, collection: "xyz.atpass.vault.meta", rkey: "self" };
  const { data } = await agent.com.atproto.repo.getRecord(repo);
  const intact = data.value;
  await agent.com.atproto.repo.putRecord({ ...repo, record: { ...intact, kdfParams: { memoryCost: 1, timeCost: 1, parallelism: 1 } } });

  const callsBefore = deriveCalls;
  const err = await vault.unlockVault(agent, "correct horse battery staple").catch((e: unknown) => e);
  assert.ok(err instanceof WeakKdfParamsError, `expected WeakKdfParamsError, got ${err}`);
  assert.ok(!(err instanceof WrongMasterPasswordError));
  assert.equal(deriveCalls, callsBefore, "key derivation must not run with the tampered params");

  // Restoring the real record makes the same password work again.
  await agent.com.atproto.repo.putRecord({ ...repo, record: intact });
  assert.ok((await vault.unlockVault(agent, "correct horse battery staple")).length === 32);
});

test("malformed records from the PDS are rejected with SchemaValidationError instead of being trusted", async () => {
  const vault = createVault(nodeCrypto);
  const agent = makeFakeAgent();
  await vault.initVault(agent, "correct horse battery staple");
  const key = await vault.unlockVault(agent, "correct horse battery staple");
  await vault.addItem(agent, key, { title: "github.com", password: "hunter2" });

  const metaRef = { repo: agent.assertDid, collection: "xyz.atpass.vault.meta", rkey: "self" };
  const intactMeta = (await agent.com.atproto.repo.getRecord(metaRef)).data.value;
  for (const bad of [
    { ...intactMeta, kdf: "pbkdf2" },
    { ...intactMeta, kdfParams: { ...intactMeta.kdfParams, memoryCost: "131072" } },
    { ...intactMeta, verifierIv: undefined },
    { ...intactMeta, createdAt: "yesterday" },
  ]) {
    await agent.com.atproto.repo.putRecord({ ...metaRef, record: bad });
    await assert.rejects(() => vault.unlockVault(agent, "correct horse battery staple"), SchemaValidationError, JSON.stringify(bad));
  }
  await agent.com.atproto.repo.putRecord({ ...metaRef, record: intactMeta });

  const { records } = (await agent.com.atproto.repo.listRecords({ collection: "xyz.atpass.vault.item" })).data;
  const itemRef = { repo: agent.assertDid, collection: "xyz.atpass.vault.item", rkey: records[0].uri.split("/").pop() };
  await agent.com.atproto.repo.putRecord({ ...itemRef, record: { ...records[0].value, alg: "none" } });
  // With random record keys a malformed record can't be tied to a title, so lookups just don't find it; the listing
  // still refuses rather than hiding it.
  await assert.rejects(() => vault.getItem(agent, key, "github.com"), ItemNotFoundError);
  await assert.rejects(() => vault.listItems(agent, key), SchemaValidationError);
});

test("a malformed item record doesn't block other items and can be deleted by its record key", async () => {
  const vault = createVault(nodeCrypto);
  const agent = makeFakeAgent();
  await vault.initVault(agent, "correct horse battery staple");
  const key = await vault.unlockVault(agent, "correct horse battery staple");
  await vault.addItem(agent, key, { title: "github.com", password: "hunter2" });
  await vault.addItem(agent, key, { title: "example.com", password: "s3cret" });

  // Break whichever record holds example.com.
  let brokenRkey = "";
  for (const rkey of await itemRkeys(agent)) {
    const { data } = await agent.com.atproto.repo.getRecord({ collection: "xyz.atpass.vault.item", rkey });
    const payload = await nodeCrypto.decryptItem<{ title: string }>(key, data.value.iv, data.value.ciphertext, `xyz.atpass.vault.item/${rkey}`);
    if (payload.title === "example.com") brokenRkey = rkey;
  }
  await agent.com.atproto.repo.putRecord({ collection: "xyz.atpass.vault.item", rkey: brokenRkey, record: { garbage: true } });

  // The listing refuses (MT-004) and names the bad record; everything else still works.
  await assert.rejects(() => vault.listItems(agent, key), new RegExp(brokenRkey));
  assert.equal((await vault.getItem(agent, key, "github.com")).password, "hunter2");
  await vault.addItem(agent, key, { title: "new.example", password: "added" });
  assert.equal((await vault.getItem(agent, key, "new.example")).password, "added");

  await vault.removeItem(agent, key, brokenRkey);
  assert.deepEqual((await vault.listItems(agent, key)).map((e) => e.title), ["github.com", "new.example"]);
});

async function itemRkeys(agent: any): Promise<string[]> {
  const { records } = (await agent.com.atproto.repo.listRecords({ collection: "xyz.atpass.vault.item" })).data;
  return records.map((r: any) => r.uri.split("/").pop());
}

test("new items get random record keys that reveal nothing about the title", async () => {
  const vault = createVault(nodeCrypto);
  const agent = makeFakeAgent();
  await vault.initVault(agent, "correct horse battery staple");
  const key = await vault.unlockVault(agent, "correct horse battery staple");
  await vault.addItem(agent, key, { title: "github.com", password: "hunter2" });
  const [rkey] = await itemRkeys(agent);
  assert.notEqual(rkey, await nodeCrypto.rkeyForName("github.com"));
  assert.match(rkey, /^[0-9a-f]{32}$/);

  // Updating keeps the same record; a second vault with the same title gets a different key.
  await vault.addItem(agent, key, { title: "GitHub.com ", password: "changed" });
  assert.deepEqual(await itemRkeys(agent), [rkey]);
  const other = makeFakeAgent();
  await vault.initVault(other, "correct horse battery staple");
  const otherKey = await vault.unlockVault(other, "correct horse battery staple");
  await vault.addItem(other, otherKey, { title: "github.com", password: "x" });
  assert.notDeepEqual(await itemRkeys(other), [rkey]);
});

test("unlocking moves items stored under legacy title-hash keys to random keys, atomically and without loss", async () => {
  const vault = createVault(nodeCrypto);
  const agent = makeFakeAgent();
  await vault.initVault(agent, "correct horse battery staple");
  const key = await vault.unlockVault(agent, "correct horse battery staple");

  // Write items the way older versions did: rkey = hash(title), AAD bound to that rkey.
  const legacy = [
    { title: "GitHub.com", username: "alice", password: "hunter2" },
    { title: "example.com", password: "s3cret", notes: "n" },
  ];
  for (const payload of legacy) {
    const rkey = await nodeCrypto.rkeyForName(payload.title);
    const { iv, ciphertext } = await nodeCrypto.encryptItem(key, payload, `xyz.atpass.vault.item/${rkey}`);
    await agent.com.atproto.repo.putRecord({
      collection: "xyz.atpass.vault.item",
      rkey,
      record: { $type: "xyz.atpass.vault.item", alg: "AES-256-GCM", iv, ciphertext, createdAt: "2025-01-01T00:00:00.000Z" },
    });
  }
  // Lookups work before migration too.
  assert.equal((await vault.getItem(agent, key, "github.com")).password, "hunter2");

  const legacyRkeys = await Promise.all(legacy.map((p) => nodeCrypto.rkeyForName(p.title)));
  await vault.unlockVault(agent, "correct horse battery staple");
  const after = await itemRkeys(agent);
  assert.equal(after.length, 2);
  for (const rkey of after) assert.ok(!legacyRkeys.includes(rkey), "legacy record key still present");

  for (const payload of legacy) assert.deepEqual(await vault.getItem(agent, key, payload.title), payload);
  const listed = await vault.listItems(agent, key);
  assert.deepEqual(listed.map((e) => e.updatedAt), ["2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"]);

  // Idempotent: nothing left to move.
  assert.equal(await vault.migrateLegacyItemKeys(agent, key), 0);
});

test("a failed migration leaves the legacy items intact and still usable", async () => {
  const vault = createVault(nodeCrypto);
  const agent = makeFakeAgent();
  await vault.initVault(agent, "correct horse battery staple");
  const key = await vault.unlockVault(agent, "correct horse battery staple");
  const payload = { title: "github.com", password: "hunter2" };
  const rkey = await nodeCrypto.rkeyForName(payload.title);
  const { iv, ciphertext } = await nodeCrypto.encryptItem(key, payload, `xyz.atpass.vault.item/${rkey}`);
  await agent.com.atproto.repo.putRecord({
    collection: "xyz.atpass.vault.item",
    rkey,
    record: { $type: "xyz.atpass.vault.item", alg: "AES-256-GCM", iv, ciphertext, createdAt: "2025-01-01T00:00:00.000Z" },
  });

  agent.com.atproto.repo.applyWrites = async () => {
    throw new Error("network down");
  };
  const errors: unknown[] = [];
  await vault.unlockVault(agent, "correct horse battery staple", { onMigrationError: (err) => errors.push(err) });
  assert.equal(errors.length, 1, "the failure is reported, not swallowed");
  assert.deepEqual(await itemRkeys(agent), [rkey]);
  assert.deepEqual(await vault.getItem(agent, key, "github.com"), payload);
});
