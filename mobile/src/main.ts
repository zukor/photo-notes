import { Capacitor } from "@capacitor/core";
import {
  Camera,
  CameraResultType,
  CameraSource,
  type Photo,
} from "@capacitor/camera";
import { App } from "@capacitor/app";
import { Filesystem } from "@capacitor/filesystem";
import { CaptureStore, type Capture } from "./store";
import { disk } from "./disk";
import "./style.css";
const store = new CaptureStore(disk);
let current: Capture | null = null,
  busy = false;
const restoredPhotos: Photo[] = [];
const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `<header><img src="/photo-notes-logo.svg" alt="Photo Notes"><p>Mobile development preview</p></header><section class="notice"><strong>Saved on this device only</strong><p>This first build tests photo capture and recovery. Account sign-in and cloud upload are not connected yet.</p></section><section><h1>Photo</h1><button id="take">Take Photo</button><button class="secondary" id="choose">Choose Photo</button><input id="file" type="file" accept="image/jpeg,image/png,image/webp" hidden><img id="preview" alt="Selected photo" hidden><label for="notes">Notes</label><textarea id="notes" placeholder="Add notes about your photo" disabled></textarea><button id="save" disabled>Save on this device</button><p id="status" role="status" aria-live="polite"></p></section><section><h2>Photos on this device</h2><p id="warning" role="alert"></p><div id="captures"></div></section>`;
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const status = (message: string) => {
  el("status").textContent = message;
};
function lock(value: boolean) {
  busy = value;
  for (const id of ["take", "choose", "save"])
    el<HTMLButtonElement>(id).disabled = value || (id === "save" && !current);
  el<HTMLTextAreaElement>("notes").disabled = value || !current;
  root
    .querySelectorAll<HTMLButtonElement>("[data-open]")
    .forEach((b) => (b.disabled = value));
}
async function select(c: Capture) {
  const data = await store.photo(c);
  current = c;
  el<HTMLImageElement>("preview").src = `data:${c.mime};base64,${data}`;
  el("preview").hidden = false;
  el<HTMLTextAreaElement>("notes").value = c.notes;
}
async function refresh() {
  const result = await store.list();
  el("warning").textContent = result.unreadable
    ? "Some local records could not be read. They have been retained for recovery."
    : "";
  const box = el("captures");
  box.replaceChildren();
  if (!result.captures.length) {
    box.textContent = "No photos saved on this device yet.";
    return;
  }
  for (const c of result.captures) {
    const button = document.createElement("button");
    button.className = "record secondary";
    button.dataset.open = c.id;
    button.disabled = busy;
    button.textContent = `${c.state === "draft" ? "Draft photo" : "Saved locally"} • ${new Date(c.createdAt).toLocaleString()}${c.notes ? " • " + c.notes.slice(0, 70) : ""}`;
    button.onclick = () =>
      run(async () => {
        if (!mayReplace()) return;
        await select(c);
        status(
          c.state === "draft"
            ? "Recovered photo. Add notes and save."
            : "Photo loaded from this device.",
        );
      });
    box.append(button);
  }
}
function mayReplace() {
  return (
    !current ||
    el<HTMLTextAreaElement>("notes").value === current.notes ||
    confirm("Leave the unsaved note edits? Your photo remains on this device.")
  );
}
async function run(fn: () => Promise<void>) {
  if (busy) return;
  lock(true);
  try {
    await fn();
  } catch {
    status(
      "The action could not be completed. Nothing has been marked as uploaded. Check permissions or available storage and try again.",
    );
  } finally {
    lock(false);
    if (restoredPhotos.length) {
      const photo = restoredPhotos.shift()!;
      queueMicrotask(
        () =>
          void run(async () => {
            await acceptNative(photo);
            status("Recovered the camera photo after an interruption.");
          }),
      );
    }
  }
}
async function accept(base64: string, mime: string) {
  if (base64.length > 35 * 1024 * 1024) throw Error("Photo too large");
  const c = await store.create(base64, mime);
  await select(c);
  await refresh();
  status("Photo kept on this device. Add notes and tap Save.");
}
async function acceptNative(photo: Photo) {
  let base64: string;
  if (photo.path && Capacitor.isNativePlatform()) {
    const r = await Filesystem.readFile({ path: photo.path });
    if (typeof r.data !== "string") throw Error("Cannot read camera photo");
    base64 = r.data;
  } else {
    if (!photo.webPath) throw Error("No photo");
    const response = await fetch(photo.webPath);
    base64 = await blobBase64(await response.blob());
  }
  await accept(
    base64,
    `image/${photo.format === "jpg" ? "jpeg" : photo.format}`,
  );
}
async function blobBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
async function pick(source: CameraSource) {
  if (!mayReplace()) return;
  if (!Capacitor.isNativePlatform()) {
    const input = el<HTMLInputElement>("file");
    if (source === CameraSource.Camera)
      input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
    return;
  }
  await run(async () => {
    const photo = await Camera.getPhoto({
      source,
      resultType: CameraResultType.Uri,
      quality: 100,
      correctOrientation: true,
      saveToGallery: false,
    });
    await acceptNative(photo);
  });
}
el("take").onclick = () => void pick(CameraSource.Camera);
el("choose").onclick = () => void pick(CameraSource.Photos);
el<HTMLInputElement>("file").onchange = (e) => {
  const input = e.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = "";
  if (file)
    void run(async () => {
      if (file.size > 25 * 1024 * 1024) throw Error("Photo too large");
      await accept(await blobBase64(file), file.type);
    });
};
el("save").onclick = () =>
  void run(async () => {
    if (!current) return;
    current = await store.save(
      current.id,
      el<HTMLTextAreaElement>("notes").value,
    );
    await refresh();
    status(
      "Photo and notes saved on this device. Cloud upload is not connected yet.",
    );
  });
if (Capacitor.isNativePlatform())
  void App.addListener("appRestoredResult", (event) => {
    if (
      event.pluginId === "Camera" &&
      event.methodName === "getPhoto" &&
      event.success
    ) {
      if (busy) restoredPhotos.push(event.data as Photo);
      else
        void run(async () => {
          await acceptNative(event.data as Photo);
          status("Recovered the camera photo after an interruption.");
        });
    }
  });
void run(async () => {
  await refresh();
  const drafts = (await store.list()).captures.filter(
    (c) => c.state === "draft",
  );
  if (drafts[0]) {
    await select(drafts[0]);
    status("Recovered your unfinished photo. Add notes and save.");
  }
});
