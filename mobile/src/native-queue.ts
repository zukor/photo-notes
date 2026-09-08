export type Upload = {
  id: string;
  edition: string;
  fields: Record<string, string>;
  photo?: { name: string; type: string; file: string; sha256?: string };
  createdAt: string;
  blocked?: string;
};
export interface Vault {
  read(name: string): Promise<string>;
  write(name: string, data: string): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}
export const encodeText = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return btoa(out);
};
export const decodeText = (text: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
export const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let out = "";
  for (let i = 0; i < bytes.length; i += 16384)
    out += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(out);
};
const editions = new Set([
  "basic",
  "pro",
  "contractor",
  "roads",
  "paving",
  "hoa",
  "concrete",
  "roofer",
]);
const digest = async (data: Uint8Array) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data))),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
function valid(row: any): row is Upload {
  return (
    !!row &&
    /^[a-f0-9-]{36}$/.test(row.id) &&
    editions.has(row.edition) &&
    row.fields &&
    typeof row.fields === "object" &&
    !Array.isArray(row.fields) &&
    Object.values(row.fields).every((v) => typeof v === "string") &&
    Number.isFinite(Date.parse(row.createdAt)) &&
    (!row.photo ||
      (typeof row.photo.name === "string" &&
        typeof row.photo.type === "string" &&
        row.photo.file === `photo-${row.id}.bin` &&
        (!row.photo.sha256 || /^[a-f0-9]{64}$/.test(row.photo.sha256))))
  );
}
export class NativeQueue {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private vault: Vault) {}
  private serial<T>(fn: () => Promise<T>) {
    const task = this.chain.then(fn);
    this.chain = task.catch(() => {});
    return task;
  }
  async list() {
    const result: Upload[] = [];
    let unreadable = 0;
    for (const name of await this.vault.list()) {
      if (!/^upload-[a-f0-9-]{36}\.json$/.test(name)) continue;
      try {
        const row = JSON.parse(decodeText(await this.vault.read(name)));
        if (!valid(row) || name !== `upload-${row.id}.json`) throw Error();
        result.push(row);
      } catch {
        unreadable++;
      }
    }
    return {
      rows: result.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      unreadable,
    };
  }
  enqueue(edition: string, fields: Record<string, string>, photo?: File) {
    return this.serial(async () => {
      const row: Upload = {
        id: crypto.randomUUID(),
        edition,
        fields,
        createdAt: new Date().toISOString(),
      };
      if (photo) {
        if (photo.size > 25 * 1024 * 1024) throw Error("Photo exceeds 25 MB");
        row.photo = {
          name: photo.name,
          type: photo.type,
          file: `photo-${row.id}.bin`,
          sha256: await digest(new Uint8Array(await photo.arrayBuffer())),
        };
        await this.vault.write(row.photo.file, await toBase64(photo));
      }
      if (!valid(row)) throw Error("Invalid capture metadata");
      await this.vault.write(
        `upload-${row.id}.json`,
        encodeText(JSON.stringify(row)),
      );
      return row;
    });
  }
  async form(row: Upload) {
    const form = new FormData();
    for (const [k, v] of Object.entries(row.fields)) form.append(k, v);
    if (row.photo) {
      let data: Uint8Array<ArrayBuffer>;
      try {
        data = Uint8Array.from(
          atob(await this.vault.read(row.photo.file)),
          (c) => c.charCodeAt(0),
        );
        if (row.photo.sha256 && (await digest(data)) !== row.photo.sha256)
          throw Error("Checksum mismatch");
      } catch {
        throw Object.assign(
          Error(
            "The local photo could not be verified. Open On This iPhone to recover its original copy.",
          ),
          { code: "LOCAL_PHOTO_UNREADABLE" },
        );
      }
      form.append(
        "photo",
        new Blob([data], { type: row.photo.type }),
        row.photo.name,
      );
    }
    return form;
  }
  async acknowledge(row: Upload) {
    await this.vault.remove(`upload-${row.id}.json`);
    if (row.photo) await this.vault.remove(row.photo.file);
  }
  async block(row: Upload, message: string) {
    row.blocked = message;
    await this.vault.write(
      `upload-${row.id}.json`,
      encodeText(JSON.stringify(row)),
    );
  }
}
