import { cp, readFile, writeFile, mkdir } from "node:fs/promises";
await cp("../public", "dist", {
  recursive: true,
  filter: (source) => !source.endsWith("/sw.js"),
});
await mkdir("dist/vendor", { recursive: true });
await cp(
  "../node_modules/html2canvas/dist/html2canvas.min.js",
  "dist/vendor/html2canvas.min.js",
);
await cp("../node_modules/leaflet/dist", "dist/vendor/leaflet", {
  recursive: true,
});
let html = await readFile("dist/index.html", "utf8");
html = html.replace(
  '<script src="/vendor/html2canvas',
  '<script src="/native.js"></script><script src="/vendor/html2canvas',
);
html = html.replace(
  "</head>",
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://photonotesapp.com https://*.arcgisonline.com https://api.mapbox.com; connect-src 'self' blob: data: https://photonotesapp.com https://*.arcgisonline.com https://api.mapbox.com; font-src 'self' data:; object-src 'none'; base-uri 'self'\"><style>html{overflow-x:clip;overflow-y:auto}body{overflow:visible;min-height:100dvh;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}#nativeSync[hidden]{display:none!important}.native-sync{position:fixed;bottom:calc(62px + env(safe-area-inset-bottom));left:12px;right:12px;width:auto;z-index:99;background:white!important;color:black!important;border:2px solid #2455d9!important}input::placeholder,textarea::placeholder{color:black!important;opacity:1}p,.status,.meta,.sub,.footer{color:black!important}</style></head>",
);
await writeFile("dist/index.html", html);
