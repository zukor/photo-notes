// Checks of the iPhone project that Xcode would otherwise only reveal on Sam's Mac.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const mobile = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(mobile, path), "utf8");
const plist = read("ios/App/App/Info.plist");
const project = read("ios/App/App.xcodeproj/project.pbxproj");
const plugin = read("ios/App/App/PhotoNotesPlugin.swift");
const recorder = read("ios/App/App/NativeRecorder.swift");
const shell = readFileSync(join(mobile, "..", "public", "native-capture.js"), "utf8");

function plistValue(key: string): string {
  const match = new RegExp(`<key>${key}</key>\\s*(<string>([^<]*)</string>|<(true|false)/>|<array>([\\s\\S]*?)</array>)`).exec(plist);
  assert.ok(match, `${key} is in Info.plist`);
  return match[2] ?? match[3] ?? match[4] ?? "";
}

test("recording continues with the screen locked", () => {
  assert.match(plistValue("UIBackgroundModes"), /<string>audio<\/string>/);
  assert.match(recorder, /setCategory\(\.playAndRecord/);
  assert.match(recorder, /AVAudioSession\.interruptionNotification/);
  assert.match(recorder, /routeChangeNotification/);
  assert.match(recorder, /kAudioFormatLinearPCM/);
});

test("permission prompts are plain English and name PhotoNotes AI", () => {
  for (const key of ["NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSLocationWhenInUseUsageDescription", "NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription"]) {
    const text = plistValue(key);
    assert.match(text, /^PhotoNotes AI /, key);
    assert.doesNotMatch(text, /\u2014/, `${key} has no em dash`);
  }
  assert.ok(!plist.includes("NSSpeechRecognitionUsageDescription"), "no speech recognition prompt");
  assert.equal(plistValue("CFBundleDisplayName"), "PhotoNotes AI");
});

test("a free personal Apple team can sign the app", () => {
  assert.ok(!project.includes("CODE_SIGN_ENTITLEMENTS"), "no entitlements file");
  assert.ok(!project.includes("APS_ENVIRONMENT"));
  assert.ok(!existsSync(join(mobile, "ios/App/App/App.entitlements")));
  assert.equal(plistValue("PhotoNotesPushEnabled"), "false");
  const ids = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(ids)], ["com.zukor.photonotes.ai"]);
  assert.ok(!project.includes("Info.Debug.plist"));
});

test("every Swift file is compiled into the app", () => {
  for (const name of ["PhotoNotesPlugin.swift", "NativeRecorder.swift", "AppDelegate.swift", "SceneDelegate.swift"]) {
    assert.match(project, new RegExp(`${name.replace(".", "\\.")} in Sources \\*/,`), name);
  }
});

test("the app shows photonotesapp.com with a local page when offline", () => {
  const config = JSON.parse(read("capacitor.config.json"));
  assert.equal(config.appId, "com.zukor.photonotes.ai");
  assert.equal(config.appName, "PhotoNotes AI");
  assert.equal(config.server.url, "https://photonotesapp.com");
  assert.equal(config.server.errorPath, "offline.html");
  assert.match(config.ios.appendUserAgent, /^PhotoNotesAI-iOS\//);
  assert.ok(existsSync(join(mobile, config.webDir, "offline.html")));
  assert.ok(existsSync(join(mobile, config.webDir, "index.html")));
});

test("every native method the web app calls exists in the plugin", () => {
  const declared = new Set([...plugin.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]));
  const called = new Set([...shell.matchAll(/call\('([a-zA-Z]+)'/g)].map((m) => m[1]));
  assert.ok(called.size >= 8);
  for (const name of called) {
    assert.ok(declared.has(name), `${name} is in pluginMethods`);
    assert.match(plugin, new RegExp(`@objc func ${name}\\(_ call: CAPPluginCall\\)`), `${name} is implemented`);
  }
  assert.match(plugin, /notifyListeners\("recordingState"/);
  assert.match(shell, /addListener\('recordingState'/);
});

test("user-facing text follows the writing rules", () => {
  for (const [name, text] of [["plugin", plugin], ["recorder", recorder], ["shell", shell], ["offline", read("www/offline.html")], ["guide", read("RUN_ON_MY_IPHONE.md")]]) {
    assert.doesNotMatch(text, /\u2014/, `${name} has no em dash`);
    assert.doesNotMatch(text, /\bown(er|ers|ership|s)\b/i, `${name} avoids owner words`);
  }
});

test("Sam's iPhone guide covers the free-account steps and the lock-screen test", () => {
  const guide = read("RUN_ON_MY_IPHONE.md");
  for (const step of ["npm install", "npx cap sync ios", "npx cap open ios", "Signing & Capabilities", "Developer Mode", "VPN & Device Management", "7 days", "lock"]) {
    assert.ok(guide.includes(step), step);
  }
});
