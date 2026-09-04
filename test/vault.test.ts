import { test } from "node:test";
import assert from "node:assert/strict";
import { createVault, WrongMasterPasswordError, ItemNotFoundError } from "../src/core/vault.js";
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
