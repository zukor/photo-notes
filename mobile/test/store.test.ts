import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CaptureStore, type Disk } from "../src/store";
class MemoryDisk implements Disk {
  files = new Map<string, string>();
  failRename = false;
  failWrite = false;
  async write(p: string, d: string) {
    if (this.failWrite) throw Error("disk full");
    this.files.set(p, d);
  }
  async read(p: string) {
    if (!this.files.has(p)) throw Error("missing");
    return this.files.get(p)!;
  }
  async rename(a: string, b: string) {
    if (this.failRename) throw Error("interrupted");
    this.files.set(b, await this.read(a));
    this.files.delete(a);
  }
  async list() {
    return [...this.files.keys()];
  }
}
test("photo and notes survive a fresh store instance", async () => {
  const disk = new MemoryDisk(),
    first = new CaptureStore(disk, randomUUID),
    photo = await first.create("YWJj", "image/jpeg");
  await first.save(photo.id, "A patio before the proposal");
  const reopened = new CaptureStore(disk);
  const c = (await reopened.list()).captures[0];
  assert.equal(c.notes, "A patio before the proposal");
  assert.equal(c.state, "saved");
  assert.equal(await reopened.photo(c), "YWJj");
});
test("camera photo is recoverable even before Save", async () => {
  const disk = new MemoryDisk();
  await new CaptureStore(disk, randomUUID).create("YWJj", "image/jpeg");
  assert.equal(
    (await new CaptureStore(disk).list()).captures[0].state,
    "draft",
  );
});
test("interrupted metadata update retains the previous committed record", async () => {
  const disk = new MemoryDisk(),
    s = new CaptureStore(disk, randomUUID),
    c = await s.create("YWJj", "image/jpeg");
  await s.save(c.id, "First");
  disk.failRename = true;
  await assert.rejects(s.save(c.id, "Second"));
  assert.equal(
    (await new CaptureStore(disk).list()).captures[0].notes,
    "First",
  );
});
test("full disk never reports a successful capture", async () => {
  const disk = new MemoryDisk();
  disk.failWrite = true;
  await assert.rejects(
    new CaptureStore(disk, randomUUID).create("YWJj", "image/jpeg"),
  );
  assert.equal((await new CaptureStore(disk).list()).captures.length, 0);
});
test("malformed metadata is reported and retained", async () => {
  const disk = new MemoryDisk();
  disk.files.set("deadbeef.json", "not JSON");
  const r = await new CaptureStore(disk).list();
  assert.equal(r.unreadable, 1);
  assert.equal(disk.files.size, 1);
});
test("parallel saves serialize revisions without dropping the last edit", async () => {
  const disk = new MemoryDisk(),
    s = new CaptureStore(disk, randomUUID),
    c = await s.create("YWJj", "image/jpeg");
  await Promise.all([s.save(c.id, "First"), s.save(c.id, "Second")]);
  const latest = (await s.list()).captures[0];
  assert.equal(latest.notes, "Second");
  assert.equal(latest.revision, 3);
});
