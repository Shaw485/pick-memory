import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packagingDir = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(packagingDir);
const manifest = JSON.parse(readFileSync(join(projectDir, "manifest.json"), "utf8"));
const releaseKey = JSON.parse(readFileSync(join(packagingDir, "release-key.json"), "utf8"));
const version = manifest.version;
const distDir = join(projectDir, "dist");
const workDir = join(distDir, `.work-${version}`);
const macName = `Pick-Memory-macOS-v${version}`;
const windowsName = `Pick-Memory-Windows-v${version}`;
const macDir = join(workDir, macName);
const windowsDir = join(workDir, windowsName);
const macZip = join(distDir, `${macName}.zip`);
const windowsZip = join(distDir, `${windowsName}.zip`);

if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
for (const target of [macZip, windowsZip]) {
  if (existsSync(target)) rmSync(target);
}
mkdirSync(macDir, { recursive: true });
mkdirSync(windowsDir, { recursive: true });

execFileSync(join(projectDir, "native-macos", "build.sh"), { stdio: "inherit" });

const extensionFiles = [
  "background.js",
  "content.js",
  "manifest.json",
  "options.html",
  "options.js",
  "popup.html",
  "popup.js",
  "scheduler.js",
  "ui.css"
];

function createExtension(destination) {
  mkdirSync(destination, { recursive: true });
  for (const file of extensionFiles) copyFileSync(join(projectDir, file), join(destination, file));
  const packagedManifest = JSON.parse(readFileSync(join(destination, "manifest.json"), "utf8"));
  packagedManifest.key = releaseKey.publicKey;
  writeFileSync(join(destination, "manifest.json"), `${JSON.stringify(packagedManifest, null, 2)}\n`);
}

createExtension(join(macDir, "extension"));
createExtension(join(windowsDir, "extension"));

const nativeDir = join(macDir, "native");
mkdirSync(nativeDir, { recursive: true });
cpSync(join(projectDir, "native-macos", "build", "拾忆卡.app"), join(nativeDir, "拾忆卡.app"), { recursive: true });
copyFileSync(join(projectDir, "native-macos", "build", "shiyi-native-host"), join(nativeDir, "shiyi-native-host"));
const nativeManifest = readFileSync(join(projectDir, "native-macos", "com.shiyi.card.json.template"), "utf8")
  .replaceAll("__EXTENSION_ID__", releaseKey.extensionId);
writeFileSync(join(nativeDir, "com.shiyi.card.json.template"), nativeManifest);

const macInstaller = readFileSync(join(packagingDir, "macos", "安装拾忆卡.command"), "utf8")
  .replaceAll("__EXTENSION_ID__", releaseKey.extensionId)
  .replaceAll("__VERSION__", version);
writeFileSync(join(macDir, "安装拾忆卡.command"), macInstaller);
chmodSync(join(macDir, "安装拾忆卡.command"), 0o755);
copyFileSync(join(packagingDir, "macos", "README.md"), join(macDir, "安装说明.md"));

copyFileSync(join(packagingDir, "windows", "安装拾忆卡.bat"), join(windowsDir, "安装拾忆卡.bat"));
copyFileSync(join(packagingDir, "windows", "README.md"), join(windowsDir, "安装说明.md"));

execFileSync("zip", ["-q", "-r", macZip, macName], { cwd: workDir });
execFileSync("zip", ["-q", "-r", windowsZip, windowsName], { cwd: workDir });

const checksums = [macZip, windowsZip]
  .map((file) => `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${file.split("/").pop()}`)
  .join("\n");
writeFileSync(join(distDir, "SHA256SUMS.txt"), `${checksums}\n`);
rmSync(workDir, { recursive: true, force: true });

console.log(`Built ${macZip}`);
console.log(`Built ${windowsZip}`);
console.log(`Public extension ID: ${releaseKey.extensionId}`);
