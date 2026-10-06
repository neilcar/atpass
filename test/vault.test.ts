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

  await vault.removeItem(agent, "example.com");
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
  await assert.rejects(() => vault.getItem(agent, key, "github.com"), SchemaValidationError);
  await assert.rejects(() => vault.listItems(agent, key), SchemaValidationError);
});

test("a malformed item record can still be overwritten or deleted", async () => {
  const vault = createVault(nodeCrypto);
  const agent = makeFakeAgent();
  await vault.initVault(agent, "correct horse battery staple");
  const key = await vault.unlockVault(agent, "correct horse battery staple");
  await vault.addItem(agent, key, { title: "github.com", password: "hunter2" });
  await vault.addItem(agent, key, { title: "example.com", password: "s3cret" });

  const { records } = (await agent.com.atproto.repo.listRecords({ collection: "xyz.atpass.vault.item" })).data;
  for (const r of records) {
    await agent.com.atproto.repo.putRecord({ collection: "xyz.atpass.vault.item", rkey: r.uri.split("/").pop(), record: { garbage: true } });
  }

  await vault.addItem(agent, key, { title: "github.com", password: "fixed" });
  assert.equal((await vault.getItem(agent, key, "github.com")).password, "fixed");
  await vault.removeItem(agent, "example.com");
  assert.deepEqual((await vault.listItems(agent, key)).map((e) => e.title), ["github.com"]);
});
