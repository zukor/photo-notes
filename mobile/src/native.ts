import { Capacitor, registerPlugin } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Filesystem } from "@capacitor/filesystem";
import { App } from "@capacitor/app";
import {
  NativeQueue,
  encodeText,
  decodeText,
  toBase64,
  type Vault,
} from "./native-queue";
const plugin = registerPlugin<any>("PhotoNotes");
const origin = "https://photonotesapp.com";
const originalFetch = window.fetch.bind(window);
let scope: string | null = null,
  edition = "",
  queue: NativeQueue | null = null,
  active = false,
  recording = false,
  retry: ReturnType<typeof setTimeout> | undefined;
const sha = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const vaultFor = (account: string): Vault => ({
  read: async (name) => (await plugin.read({ scope: account, name })).data,
  write: async (name, data) => plugin.write({ scope: account, name, data }),
  remove: async (name) => plugin.remove({ scope: account, name }),
  list: async () => (await plugin.list({ scope: account })).names,
});
const ui = window as any;
function tell(message: string) {
  if (typeof ui.toast === "function") ui.toast(message);
}
async function transport(
  path: string,
  options: RequestInit = {},
  expectedScope: string | null = scope,
) {
  const headers = new Headers(options.headers),
    method = (options.method || "GET").toUpperCase();
  let body: string | undefined;
  if (options.body instanceof FormData) {
    const response = new Response(options.body);
    headers.set("Content-Type", response.headers.get("Content-Type")!);
    body = await toBase64(await response.blob());
  } else if (options.body instanceof Blob) body = await toBase64(options.body);
  else if (typeof options.body === "string") body = encodeText(options.body);
  else if (options.body instanceof ArrayBuffer)
    body = await toBase64(new Blob([options.body]));
  else if (options.body) throw Error("Unsupported request body");
  const result = await plugin.request({
    path,
    expectedScope,
    method,
    headers: Object.fromEntries(headers),
    body,
  });
  if (
    result.headers["x-photo-notes-fixture"] === "1" &&
    !document.getElementById("nativeFixture")
  ) {
    const badge = document.createElement("div");
    badge.id = "nativeFixture";
    badge.textContent = "iOS test data";
    badge.style.cssText =
      "position:fixed;top:0;left:0;background:white;color:black;font:11px Arial;z-index:200";
    document.body.append(badge);
  }
  return new Response(
    [204, 205, 304].includes(result.status)
      ? null
      : Uint8Array.from(atob(result.body), (c) => c.charCodeAt(0)),
    { status: result.status, headers: result.headers },
  );
}
if (Capacitor.getPlatform() === "ios") {
  window.fetch = async (input, options = {}) => {
    const value =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(value, location.href);
    if (
      (url.origin === location.origin ||
        url.origin === origin ||
        url.protocol === "capacitor:") &&
      (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/"))
    ) {
      if (url.pathname === "/api/logout") {
        await stopRecording();
        await disableNotifications(false);
        let response: Response;
        try {
          response = await transport(url.pathname + url.search, options);
        } catch (error: any) {
          // Native OFFLINE is returned only after the Keychain session was cleared.
          if (error?.code !== "OFFLINE") throw error;
          response = new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        scope = null;
        queue = null;
        edition = "";
        if (retry) clearTimeout(retry);
        await clearProfile();
        for (const pending of imageCache.values()) {
          void pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
        }
        imageCache.clear();
        queueNotice("");
        document.getElementById("nativeLocalDialog")?.remove();
        return response;
      }
      const response = await transport(url.pathname + url.search, options);
      if (url.pathname === "/api/me" && response.status === 401)
        await clearProfile();
      return response;
    }
    return originalFetch(input, options);
  };
  const imageSource = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "src",
  )!;
  originalImageSource = imageSource;
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    ...imageSource,
    set(value: string) {
      if (isRemoteImage(value)) void resolveImage(this, value);
      else {
        imageRequests.delete(this);
        imageSource.set!.call(this, value);
      }
    },
  });
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: (data: ShareData) => !data.files || data.files.length <= 25,
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async (data: ShareData) => {
      const files = await Promise.all(
        (data.files || []).map(async (file) => ({
          name: file.name,
          data: await toBase64(file),
        })),
      );
      const result = await plugin.share({
        files,
        text: data.text,
        url: data.url,
      });
      if (!result.completed)
        throw new DOMException("Sharing cancelled", "AbortError");
    },
  });
  window.print = () => {
    void plugin.printPage();
  };
  const click = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (
      this.type === "file" &&
      this.accept.includes("image") &&
      !this.multiple
    ) {
      void choose(this);
      return;
    }
    click.call(this);
  };
  document.addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as HTMLElement)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (anchor.download && href.startsWith("blob:")) {
        event.preventDefault();
        void originalFetch(href)
          .then((r) => r.blob())
          .then((blob) => share(blob, anchor.download));
      } else if (/^https:|^mailto:|^tel:|^\/admin/.test(href)) {
        event.preventDefault();
        void plugin.openExternal({ url: new URL(href, origin).href });
      }
    },
    true,
  );
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith("blob:")) {
      void originalFetch(this.href)
        .then((r) => r.blob())
        .then((blob) => share(blob, this.download));
      return;
    }
    anchorClick.call(this);
  };
  window.open = ((url?: string | URL) => {
    if (url)
      void plugin.openExternal({ url: new URL(String(url), origin).href });
    return null;
  }) as typeof window.open;
  const observer = new MutationObserver(() => {
    const menu = document.getElementById("profileMenu");
    if (menu && !document.getElementById("nativeLocalFiles")) {
      const button = document.createElement("button");
      button.id = "nativeLocalFiles";
      button.textContent = "On This iPhone";
      button.onclick = () => void showLocalFiles();
      menu.append(button);
    }
    document.querySelectorAll<HTMLImageElement>("img[src]").forEach((img) => {
      const source = img.getAttribute("src") || "";
      if (isRemoteImage(source)) {
        img.removeAttribute("src");
        void resolveImage(img, source);
      }
    });
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  void plugin.addListener("recordingInterrupted", () => void stopRecording());
  void plugin.addListener("issueNotificationOpened", () => {
    ui.PhotoNotesNative.issueOpenPending = true;
    if (ui.openNativeIssues) ui.openNativeIssues();
  });
  void App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive && recording) void stopRecording();
    if (isActive) void drain();
  });
  window.addEventListener("online", () => void drain());
  ui.PhotoNotesNative = {
    account,
    buildInfo: "Photo Notes AI iOS",
    setEdition: (value: string) => {
      edition = value;
    },
    enqueue,
    restore: drain,
    record: toggleRecording,
    stopRecording,
    share,
    request: transport,
    draft: saveDraft,
    restoreDraft,
    clearDraft,
    offlineMe,
    notifications: configureNotifications,
    issueOpenPending: false,
    photoURL: (path: string) => path,
  };
  void App.getInfo()
    .then((info) => {
      ui.PhotoNotesNative.buildInfo = `Photo Notes AI iOS ${info.version} (${info.build}); ${info.id}`;
    })
    .catch(() => {});
}
async function profileVault() {
  return vaultFor(await sha("PhotoNotes-profile-v1"));
}
async function clearProfile() {
  await (await profileVault()).remove("session.json");
}
async function offlineMe() {
  try {
    const value = JSON.parse(
      decodeText(await (await profileVault()).read("session.json")),
    );
    if (Date.now() > value.until) return null;
    return value.me;
  } catch {
    return null;
  }
}
async function account(me: any, selected: string, offline = false) {
  scope = await sha(String(me.email).trim().toLowerCase());
  edition = selected;
  queue = new NativeQueue(vaultFor(scope));
  if (!offline)
    await (
      await profileVault()
    ).write(
      "session.json",
      encodeText(JSON.stringify({ me, until: Date.now() + 7 * 86400000 })),
    );
  void drain();
  void restoreNotifications();
}
function queueNotice(message: string) {
  let box = document.getElementById("nativeSync");
  if (!box) {
    box = document.createElement("button");
    box.id = "nativeSync";
    box.className = "btn secondary native-sync";
    box.onclick = () => {
      void drain(true);
    };
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.hidden = !message;
}
async function enqueue(payload: any) {
  if (!queue || !scope) throw Error("Sign in first");
  const accountScope = scope,
    selected = edition,
    work = queue;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload))
    if (key !== "photo" && key !== "photoName" && value != null)
      fields[key] = String(value);
  await work.enqueue(selected, fields, payload.photo || undefined);
  await clearDraft(accountScope, selected);
  void drain();
}
let drainRequested = false;
async function drain(manual = false) {
  if (active) {
    drainRequested = true;
    return;
  }
  if (!scope || !queue) return;
  const accountScope = scope,
    work = queue,
    selected = edition;
  active = true;
  try {
    const { rows, unreadable } = await work.list();
    if (!rows.length) {
      queueNotice(unreadable ? "Some local records need recovery." : "");
      return;
    }
    queueNotice(
      `${rows.length} photo${rows.length === 1 ? "" : "s"} saved on this iPhone. Tap to retry upload.`,
    );
    const me = await transport("/api/me");
    if (scope !== accountScope) return;
    if (!me.ok) {
      queueNotice("Sign in again to upload your saved photos.");
      return;
    }
    if (me.headers.get("x-photo-notes-mobile") !== "1") {
      queueNotice(
        "Photos saved on this iPhone. Server update required for safe upload.",
      );
      return;
    }
    const profile = await me.json();
    if (
      (await sha(String(profile.email).trim().toLowerCase())) !== accountScope
    )
      return;
    for (const row of rows) {
      if (scope !== accountScope || edition !== selected) return;
      if (
        row.edition !== selected ||
        !profile.edition_access?.includes(row.edition)
      )
        continue;
      if (row.blocked && !manual) continue;
      let form: FormData;
      try {
        form = await work.form(row);
      } catch (error: any) {
        await work.block(row, error.message || "Local photo needs recovery");
        queueNotice(
          "A local photo needs recovery. Open Account menu, On This iPhone.",
        );
        return;
      }
      const response = await transport(
        "/api/captures",
        {
          method: "POST",
          headers: {
            "X-Photo-Notes-Capture-Id": row.id,
            "X-Photo-Notes-Edition": row.edition,
            "X-Photo-Notes-Account": accountScope,
          },
          body: form,
        },
        accountScope,
      );
      if (!response.ok) {
        if ([400, 401, 403, 409, 413, 422].includes(response.status)) {
          const error = await response.json().catch(() => ({}));
          await work.block(row, error.error || "Upload needs attention");
          queueNotice(
            "A saved photo needs attention. Select its version and tap to retry.",
          );
          return;
        }
        throw Error("Upload unavailable");
      }
      const saved = await response.json();
      if (!saved.id) throw Error("Unconfirmed upload");
      await work.acknowledge(row);
    }
    const remaining = await work.list();
    queueNotice(
      remaining.rows.length
        ? `${remaining.rows.length} saved photo(s) waiting. Select their version or tap to retry.`
        : "",
    );
    if (!remaining.rows.length) tell("All saved photos uploaded");
  } catch {
    if (scope !== accountScope) return;
    queueNotice(
      "Photos saved on this iPhone. Upload will retry when connected.",
    );
    if (retry) clearTimeout(retry);
    retry = setTimeout(() => void drain(), 30000);
  } finally {
    active = false;
    if (drainRequested) {
      drainRequested = false;
      queueMicrotask(() => void drain());
    }
  }
}
async function choose(input: HTMLInputElement) {
  try {
    const source = input.hasAttribute("capture")
      ? "camera"
      : (await plugin.photoSource()).source;
    if (source === "cancel") return;
    let file: File;
    if (source === "files") {
      const selected = await plugin.chooseImageFile();
      file = new File(
        [Uint8Array.from(atob(selected.data), (c) => c.charCodeAt(0))],
        selected.name,
        { type: selected.type },
      );
    } else {
      const photo = await Camera.getPhoto({
        source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
        resultType: CameraResultType.Uri,
        quality: 100,
        correctOrientation: true,
        saveToGallery: false,
      });
      if (!photo.path) throw Error("No photo returned");
      const result = await Filesystem.readFile({ path: photo.path });
      const bytes = Uint8Array.from(atob(String(result.data)), (c) =>
        c.charCodeAt(0),
      );
      file = new File([bytes], `photo-${Date.now()}.${photo.format}`, {
        type: `image/${photo.format === "jpg" ? "jpeg" : photo.format}`,
      });
    }
    if (file.size > 25 * 1024 * 1024) throw Error("Photo exceeds 25 MB");
    if (scope) {
      const key = crypto.randomUUID(),
        name = `picked-${key}.bin`,
        vault = vaultFor(scope);
      await vault.write(name, await toBase64(file));
      photoReferences.set(file, { scope, name });
      await vault.write(
        `picked-${key}.json`,
        encodeText(
          JSON.stringify({
            file: name,
            name: file.name,
            type: file.type,
            edition,
            createdAt: new Date().toISOString(),
          }),
        ),
      );
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (e: any) {
    if (!/cancel/i.test(e.message || ""))
      tell(
        e.message ||
          "Photo could not be saved. Check camera permissions and storage.",
      );
  }
}
let draftChain: Promise<unknown> = Promise.resolve();
const photoReferences = new WeakMap<File, { scope: string; name: string }>();
async function saveDraft(payload: any) {
  if (!scope) return;
  const accountScope = scope,
    selected = edition;
  draftChain = draftChain
    .catch(() => {})
    .then(async () => {
      const vault = vaultFor(accountScope),
        value = { ...payload, edition: selected };
      if (payload.photo) {
        let ref = photoReferences.get(payload.photo);
        if (!ref || ref.scope !== accountScope) {
          ref = {
            scope: accountScope,
            name: `draft-${crypto.randomUUID()}.bin`,
          };
          await vault.write(ref.name, await toBase64(payload.photo));
          photoReferences.set(payload.photo, ref);
        }
        value.photo = {
          name: payload.photo.name,
          type: payload.photo.type,
          file: ref.name,
        };
      }
      await vault.write(
        `draft-${selected}.json`,
        encodeText(JSON.stringify(value)),
      );
    });
  await draftChain;
}
async function restoreDraft() {
  if (!scope) return null;
  try {
    const vault = vaultFor(scope),
      value = JSON.parse(decodeText(await vault.read(`draft-${edition}.json`)));
    if (value.edition !== edition) return null;
    if (value.photo) {
      const data = await vault.read(value.photo.file);
      const storedPhotoName = value.photo.file;
      value.photo = new File(
        [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
        value.photo.name,
        { type: value.photo.type },
      );
      photoReferences.set(value.photo, {
        scope: scope!,
        name: storedPhotoName,
      });
    }
    return value;
  } catch {
    return null;
  }
}
async function clearDraft(accountScope = scope, selected = edition) {
  await draftChain.catch(() => {});
  if (accountScope)
    await vaultFor(accountScope).remove(`draft-${selected}.json`);
}
let recordingStart: Promise<void> | null = null,
  recordingStop: Promise<void> | null = null;
let recordingContext: {
  scope: string;
  edition: string;
  note: HTMLTextAreaElement | null;
  name: string;
} | null = null;
async function toggleRecording() {
  if (recordingStart) return recordingStart;
  if (recordingStop) return recordingStop;
  if (recording) return stopRecording();
  if (!scope) {
    tell("Sign in before recording");
    return;
  }
  const context = {
    scope,
    edition,
    note: document.getElementById("note") as HTMLTextAreaElement | null,
    name: `notes-${crypto.randomUUID()}.m4a`,
  };
  recordingStart = (async () => {
    try {
      await plugin.recordStart({ scope: context.scope, name: context.name });
      recordingContext = context;
      recording = true;
      const button = document.getElementById("dictate");
      if (button) {
        button.textContent = "Stop Recording";
        button.classList.add("on");
      }
      tell("Recording notes. Tap Stop Recording when finished.");
    } finally {
      recordingStart = null;
    }
  })();
  return recordingStart;
}
async function stopRecording() {
  if (recordingStart) await recordingStart;
  if (recordingStop) return recordingStop;
  if (!recording || !recordingContext) return;
  const context = recordingContext;
  recording = false;
  const button = document.getElementById("dictate");
  if (button) button.textContent = "Turning recording into words...";
  recordingStop = (async () => {
    try {
      const result = await plugin.recordStop({
        locale: ui.uiSpeechLanguage?.() || "en-US",
      });
      await vaultFor(context.scope).write(
        context.name.replace(".m4a", ".json"),
        encodeText(
          JSON.stringify({
            file: context.name,
            text: result.text || "",
            edition: context.edition,
            createdAt: new Date().toISOString(),
          }),
        ),
      );
      if (
        result.text &&
        context.note &&
        context.scope === scope &&
        context.edition === edition &&
        context.note === document.getElementById("note")
      ) {
        context.note.value = [context.note.value, result.text]
          .filter(Boolean)
          .join(" ");
        context.note.dispatchEvent(new Event("input", { bubbles: true }));
      } else
        tell(
          "Audio saved in Account menu, On This iPhone. You can type notes or export the recording.",
        );
    } catch {
      tell("Recording interrupted. Check On This iPhone for saved audio.");
    } finally {
      if (button && button === document.getElementById("dictate")) {
        button.textContent = "Record Notes";
        button.classList.remove("on");
      }
      recordingContext = null;
      recordingStop = null;
    }
  })();
  return recordingStop;
}
async function share(blob: Blob, name: string) {
  try {
    return await plugin.share({ name, data: await toBase64(blob) });
  } catch {
    tell("Could not open the iPhone share sheet. Please try again.");
  }
}

async function showLocalFiles() {
  if (!scope || !queue) return;
  const accountScope = scope,
    vault = vaultFor(accountScope),
    work = queue;
  document.getElementById("nativeLocalDialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "nativeLocalDialog";
  dialog.style.cssText =
    "width:94vw;max-width:700px;max-height:90vh;overflow:auto;color:black;background:white;border:2px solid #2455d9;border-radius:14px;padding:18px";
  const heading = document.createElement("h2");
  heading.textContent = "On This iPhone";
  dialog.append(heading);
  const close = document.createElement("button");
  close.className = "btn secondary";
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  dialog.append(close);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  const intro = document.createElement("p");
  intro.textContent =
    "These local copies belong to the signed-in account. Export anything you need before removing the app.";
  dialog.append(intro);
  const { rows, unreadable } = await work.list();
  for (const row of rows) {
    const item = document.createElement("p");
    item.textContent = `${row.edition}: ${row.fields.note || "Photo"} - ${row.blocked || "Waiting to upload"}`;
    dialog.append(item);
  }
  if (unreadable) {
    const warning = document.createElement("p");
    warning.textContent =
      "Some records are unreadable and have been retained for recovery.";
    dialog.append(warning);
  }
  const retryButton = document.createElement("button");
  retryButton.className = "btn";
  retryButton.textContent = "Retry uploads for the selected version";
  retryButton.onclick = () => {
    dialog.close();
    void drain(true);
  };
  dialog.append(retryButton);
  const names = await vault.list();
  for (const name of names.filter(
    (n) =>
      /^picked-.*\.json$/.test(n) ||
      (/^picked-.*\.bin$/.test(n) &&
        !names.includes(n.replace(".bin", ".json"))) ||
      /^notes-.*\.m4a$/.test(n),
  )) {
    try {
      const audio = name.endsWith(".m4a");
      const value = audio
        ? {
            file: name,
            name: "Recorded notes.m4a",
            type: "audio/mp4",
            edition: "",
          }
        : name.endsWith(".bin")
          ? {
              file: name,
              name: "Recovered photo.jpg",
              type: "image/jpeg",
              edition: "interrupted capture",
            }
          : JSON.parse(decodeText(await vault.read(name)));
      const section = document.createElement("section");
      section.style.cssText =
        "border-top:1px solid black;margin-top:16px;padding-top:12px";
      const title = document.createElement("p");
      title.textContent = audio
        ? "Saved recording"
        : `Photo captured for ${value.edition} ${value.createdAt ? new Date(value.createdAt).toLocaleString() : ""}`;
      section.append(title);
      const exportButton = document.createElement("button");
      exportButton.className = "btn secondary";
      exportButton.textContent = audio
        ? "Play or export recording"
        : "Export photo";
      exportButton.onclick = async () => {
        if (scope !== accountScope) return;
        await plugin.share({
          name: value.name,
          data: await vault.read(value.file),
        });
      };
      section.append(exportButton);
      if (!audio) {
        const recover = document.createElement("button");
        recover.className = "btn secondary";
        recover.textContent = "Open as a new capture";
        recover.onclick = async () => {
          if (scope !== accountScope) return;
          const data = Uint8Array.from(
            atob(await vault.read(value.file)),
            (c) => c.charCodeAt(0),
          );
          dialog.close();
          await ui.openNativeRecoveredPhoto(
            new File([data], value.name, { type: value.type }),
          );
        };
        section.append(recover);
      }
      dialog.append(section);
    } catch {
      const warning = document.createElement("p");
      warning.textContent =
        "A local file could not be read. It has been retained.";
      dialog.append(warning);
    }
  }
  if (
    !rows.length &&
    !names.some((n) => n.startsWith("picked-") || n.endsWith(".m4a"))
  ) {
    const empty = document.createElement("p");
    empty.textContent = "No pending photos or saved recordings.";
    dialog.append(empty);
  }
}

var originalImageSource: PropertyDescriptor;
const imageRequests = new WeakMap<HTMLImageElement, string>();
const imageCache = new Map<string, Promise<string>>();
function isRemoteImage(value: string) {
  try {
    const url = new URL(value, location.href);
    return (
      (url.origin === location.origin ||
        url.origin === origin ||
        url.protocol === "capacitor:") &&
      (url.pathname.startsWith("/uploads/") || url.pathname.startsWith("/api/"))
    );
  } catch {
    return false;
  }
}
async function resolveImage(img: HTMLImageElement, value: string) {
  imageRequests.set(img, value);
  try {
    const url = new URL(value, location.href),
      key = `${scope}:${url.pathname}${url.search}`;
    if (!imageCache.has(key))
      imageCache.set(
        key,
        transport(url.pathname + url.search)
          .then(async (response) => {
            if (!response.ok) throw Error("Photo unavailable");
            return URL.createObjectURL(await response.blob());
          })
          .catch((error) => {
            imageCache.delete(key);
            throw error;
          }),
      );
    const objectURL = await imageCache.get(key)!;
    if (imageRequests.get(img) === value)
      originalImageSource.set!.call(img, objectURL);
  } catch {
    if (imageRequests.get(img) === value) img.dispatchEvent(new Event("error"));
  }
}

async function configureNotifications(action: string) {
  if (action === "disable") {
    await disableNotifications();
    return "Issue notifications disabled on this iPhone.";
  }
  if (!scope) throw Error("Sign in before enabling notifications.");
  const accountScope = scope;
  const status = await transport("/api/issues/ios-push-status");
  const config = await status.json();
  if (!status.ok || !config.configured)
    throw Error(
      "Apple notifications need server configuration. You can still check My Issue Reports inside Photo Notes.",
    );
  const subscription = await plugin.notificationsEnable();
  if (scope !== accountScope) {
    await plugin.notificationsDisable();
    throw Error("Account changed. Enable notifications after signing in.");
  }
  const response = await transport(
    "/api/issues/ios-push-subscription",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    },
    accountScope,
  );
  if (!response.ok)
    throw Error("Could not save iPhone notification settings. Try again.");
  await vaultFor(accountScope).write(
    "push.json",
    encodeText(JSON.stringify(subscription)),
  );
  return "Issue notifications enabled on this iPhone.";
}
async function disableNotifications(removePreference = true) {
  const accountScope = scope;
  await plugin.notificationsDisable();
  if (!accountScope) return;
  try {
    const vault = vaultFor(accountScope),
      subscription = JSON.parse(decodeText(await vault.read("push.json")));
    void transport(
      "/api/issues/ios-push-subscription",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      },
      accountScope,
    ).catch(() => {});
    if (removePreference) await vault.remove("push.json");
  } catch {}
}
async function restoreNotifications() {
  if (!scope) return;
  try {
    await vaultFor(scope).read("push.json");
    await configureNotifications("enable");
  } catch {}
}
