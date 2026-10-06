import { test } from "node:test";
import assert from "node:assert/strict";
import { assertKdfParams, KDF_DEFAULTS, KDF_MINIMUMS, WeakKdfParamsError } from "../src/core/types.js";
import { nodeCrypto } from "../src/core/node/crypto.js";
import { webCrypto } from "../src/core/web/crypto.js";

const salt = new Uint8Array(16).fill(7);

test("defaults and anything stronger pass validation", () => {
  assert.doesNotThrow(() => assertKdfParams(KDF_DEFAULTS));
  assert.doesNotThrow(() => assertKdfParams({ memoryCost: 131072, timeCost: 4, parallelism: 2 }));
});

test("a vault created with the current defaults always passes the floor", () => {
  // Guards against raising KDF_DEFAULTS in the future without also deciding what happens to existing vaults.
  for (const field of Object.keys(KDF_MINIMUMS) as (keyof typeof KDF_MINIMUMS)[]) {
    assert.ok(KDF_DEFAULTS[field] >= KDF_MINIMUMS[field], `${field} default is below its minimum`);
  }
});

test("each parameter below its minimum is rejected, and named", () => {
  for (const field of Object.keys(KDF_MINIMUMS) as (keyof typeof KDF_MINIMUMS)[]) {
    const weak = { ...KDF_DEFAULTS, [field]: KDF_MINIMUMS[field] - 1 };
    assert.throws(
      () => assertKdfParams(weak),
      (err: unknown) => err instanceof WeakKdfParamsError && err.fields.length === 1 && err.fields[0] === field,
    );
  }
});

test("the attack from the report (memoryCost 1, timeCost 1) is rejected", () => {
  assert.throws(() => assertKdfParams({ memoryCost: 1, timeCost: 1, parallelism: 1 }), WeakKdfParamsError);
});

test("missing, non-numeric, non-integer and non-finite values are rejected", () => {
  const bad: unknown[] = [
    undefined,
    null,
    "nope",
    {},
    { memoryCost: 65536, timeCost: 3 },
    { memoryCost: "65536", timeCost: 3, parallelism: 1 }, // would pass a bare >= via string coercion
    { memoryCost: 65536, timeCost: 3.5, parallelism: 1 },
    { memoryCost: NaN, timeCost: 3, parallelism: 1 },
    { memoryCost: Infinity, timeCost: 3, parallelism: 1 },
    { memoryCost: 65536, timeCost: 3, parallelism: null },
  ];
  for (const value of bad) {
    assert.throws(() => assertKdfParams(value), WeakKdfParamsError, JSON.stringify(value));
  }
});

for (const [name, adapter] of [
  ["node", nodeCrypto],
  ["web", webCrypto],
] as const) {
  test(`${name} adapter refuses to derive a key from weak params`, async () => {
    await assert.rejects(
      () => adapter.deriveVaultKey("hunter2 master", salt, { memoryCost: 1, timeCost: 1, parallelism: 1 }),
      WeakKdfParamsError,
    );
  });

  test(`${name} adapter still derives with stronger-than-default params`, async () => {
    const key = await adapter.deriveVaultKey("hunter2 master", salt, { memoryCost: 65536, timeCost: 4, parallelism: 1 });
    assert.equal(key.length, 32);
  });
}

test("both adapters enforce the same floor", async () => {
  const edge = { ...KDF_MINIMUMS, timeCost: KDF_MINIMUMS.timeCost - 1 };
  const results = await Promise.allSettled([
    nodeCrypto.deriveVaultKey("p", salt, edge),
    webCrypto.deriveVaultKey("p", salt, edge),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    ["rejected", "rejected"],
  );
});
