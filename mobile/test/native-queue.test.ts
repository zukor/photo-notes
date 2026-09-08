import { test } from "node:test";
import assert from "node:assert/strict";
import { NativeQueue, type Vault } from "../src/native-queue";
class Disk implements Vault {
  files = new Map<string, string>();
  fail = false;
  async write(n: string, d: string) {
    if (this.fail) throw Error("full");
    this.files.set(n, d);
  }
  async read(n: string) {
    if (!this.files.has(n)) throw Error("missing");
    return this.files.get(n)!;
  }
  async remove(n: string) {
    this.files.delete(n);
  }
  async list() {
    return [...this.files.keys()];
  }
}
test("queued photo and edition survive reopen with an unchanged retry identity", async () => {
  const disk = new Disk(),
    q = new NativeQueue(disk);
  const row = await q.enqueue(
    "concrete",
    { note: "Before proposal" },
    new File(["photo"], "patio.jpg", { type: "image/jpeg" }),
  );
  const restored = (await new NativeQueue(disk).list()).rows[0];
  assert.equal(restored.id, row.id);
  assert.equal(restored.edition, "concrete");
  assert.equal(
    await ((await q.form(restored)).get("photo") as File).text(),
    "photo",
  );
});
test("full disk never reports queued success", async () => {
  const disk = new Disk();
  disk.fail = true;
  await assert.rejects(new NativeQueue(disk).enqueue("basic", {}));
  assert.equal((await new NativeQueue(disk).list()).rows.length, 0);
});
test("different account vaults cannot restore each others captures", async () => {
  const a = new NativeQueue(new Disk()),
    b = new NativeQueue(new Disk());
  await a.enqueue("pro", { note: "Account A" });
  assert.equal((await b.list()).rows.length, 0);
});
test("acknowledgment removes only the confirmed record and its photo", async () => {
  const disk = new Disk(),
    q = new NativeQueue(disk);
  const a = await q.enqueue("basic", {}, new File(["a"], "a.jpg")),
    b = await q.enqueue("pro", {});
  await q.acknowledge(a);
  assert.deepEqual(
    (await q.list()).rows.map((r) => r.id),
    [b.id],
  );
  assert.equal(disk.files.has(a.photo!.file), false);
});
test("blocked and malformed records remain available instead of being discarded", async () => {
  const disk = new Disk(),
    q = new NativeQueue(disk);
  const row = await q.enqueue("basic", {});
  await q.block(row, "Access changed");
  await disk.write(`upload-${crypto.randomUUID()}.json`, "broken");
  const result = await q.list();
  assert.equal(result.rows[0].blocked, "Access changed");
  assert.equal(result.unreadable, 1);
});

test("changed or missing photo bytes cannot be uploaded as the original capture", async () => {
  const disk = new Disk(),
    q = new NativeQueue(disk),
    row = await q.enqueue(
      "basic",
      {},
      new File(["original"], "a.jpg", { type: "image/jpeg" }),
    );
  await disk.write(row.photo!.file, btoa("changed"));
  await assert.rejects(
    q.form(row),
    (error: any) => error.code === "LOCAL_PHOTO_UNREADABLE",
  );
  assert.equal((await q.list()).rows.length, 1);
});
test("a failed operation does not poison later saves", async () => {
  const disk = new Disk(),
    q = new NativeQueue(disk);
  disk.fail = true;
  await assert.rejects(q.enqueue("basic", {}));
  disk.fail = false;
  await q.enqueue("pro", { note: "Recovered" });
  assert.equal((await q.list()).rows[0].fields.note, "Recovered");
});
test("metadata with an invalid photo path is retained and flagged", async () => {
  const disk = new Disk(),
    q = new NativeQueue(disk);
  const row = await q.enqueue("basic", {}, new File(["photo"], "a.jpg"));
  const broken = {
    ...row,
    photo: { ...row.photo, file: "../another-account.bin" },
  };
  await disk.write(`upload-${row.id}.json`, btoa(JSON.stringify(broken)));
  assert.equal((await q.list()).rows.length, 0);
  assert.equal((await q.list()).unreadable, 1);
});
