import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import type { Disk } from "./store";
const root = "photo-notes-prototype";
export const disk: Disk = {
  async write(path, data) {
    await Filesystem.writeFile({
      path: `${root}/${path}`,
      data,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  },
  async read(path) {
    const r = await Filesystem.readFile({
      path: `${root}/${path}`,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    if (typeof r.data !== "string") throw Error("Could not read local data");
    return r.data;
  },
  async rename(from, to) {
    await Filesystem.rename({
      from: `${root}/${from}`,
      to: `${root}/${to}`,
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
  },
  async list() {
    await Filesystem.mkdir({
      path: root,
      directory: Directory.Data,
      recursive: true,
    }).catch(() => {});
    return (
      await Filesystem.readdir({ path: root, directory: Directory.Data })
    ).files.map((f) => f.name);
  },
};
