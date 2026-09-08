export type Capture = {
  schema: 1;
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  photoPath: string;
  mime: string;
  notes: string;
  state: "draft" | "saved";
};
export interface Disk {
  write(path: string, data: string): Promise<void>;
  read(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  list(): Promise<string[]>;
}
const idPattern = /^[a-f0-9-]{36}$/;
export function validCapture(value: unknown): value is Capture {
  const c = value as Capture;
  return (
    !!c &&
    c.schema === 1 &&
    idPattern.test(c.id) &&
    Number.isSafeInteger(c.revision) &&
    c.revision > 0 &&
    c.photoPath === `photos/${c.id}.bin` &&
    /^image\/(jpeg|png|webp|heic|heif)$/.test(c.mime) &&
    typeof c.notes === "string" &&
    c.notes.length <= 20000 &&
    ["draft", "saved"].includes(c.state) &&
    Number.isFinite(Date.parse(c.createdAt)) &&
    Number.isFinite(Date.parse(c.updatedAt))
  );
}
export class CaptureStore {
  private work: Promise<unknown> = Promise.resolve();
  constructor(
    private disk: Disk,
    private uuid = () => crypto.randomUUID(),
    private now = () => new Date().toISOString(),
  ) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.work.then(fn);
    this.work = task.catch(() => {});
    return task;
  }
  private async commit(c: Capture) {
    if (!validCapture(c)) throw Error("Invalid local capture");
    const key = `${c.id}-${this.uuid()}`;
    await this.disk.write(`${key}.tmp`, JSON.stringify(c));
    await this.disk.rename(`${key}.tmp`, `${key}.json`);
  }
  async list() {
    const records = new Map<string, Capture>();
    let unreadable = 0;
    for (const name of await this.disk.list()) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
      try {
        const c: unknown = JSON.parse(await this.disk.read(name));
        if (!validCapture(c)) throw Error();
        const prev = records.get(c.id);
        if (!prev || prev.revision < c.revision) records.set(c.id, c);
      } catch {
        unreadable++;
      }
    }
    return {
      captures: [...records.values()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
      unreadable,
    };
  }
  create(base64: string, mime: string) {
    return this.serial(async () => {
      if (!base64 || !/^[-A-Za-z0-9+/=\s]+$/.test(base64))
        throw Error("Invalid photo data");
      const id = this.uuid(),
        date = this.now();
      const c: Capture = {
        schema: 1,
        id,
        revision: 1,
        createdAt: date,
        updatedAt: date,
        photoPath: `photos/${id}.bin`,
        mime,
        notes: "",
        state: "draft",
      };
      if (!validCapture(c)) throw Error("Unsupported photo");
      await this.disk.write(c.photoPath, base64);
      await this.commit(c);
      return c;
    });
  }
  save(id: string, notes: string) {
    return this.serial(async () => {
      const c = (await this.list()).captures.find((c) => c.id === id);
      if (!c) throw Error("Local photo could not be found");
      const next: Capture = {
        ...c,
        revision: c.revision + 1,
        notes,
        updatedAt: this.now(),
        state: "saved",
      };
      await this.commit(next);
      return next;
    });
  }
  async photo(c: Capture) {
    if (!validCapture(c)) throw Error("Invalid photo reference");
    return this.disk.read(c.photoPath);
  }
}
