import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const tauriRoot = path.join(desktopRoot, "src-tauri");
const configPath = path.join(tauriRoot, "tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const productName = config.productName ?? "Joudo";
const version = config.version ?? "0.1.0";
const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x64" : process.arch;

const bundleRoot = path.join(tauriRoot, "target", "release", "bundle");
const appPath = path.join(bundleRoot, "macos", `${productName}.app`);
const dmgDir = path.join(bundleRoot, "dmg");
const outputPath = path.join(dmgDir, `${productName}_${version}_${arch}.dmg`);

if (!existsSync(appPath)) {
  console.error(`Missing app bundle: ${appPath}`);
  console.error("Run `pnpm tauri:build:app` first.");
  process.exit(1);
}

mkdirSync(dmgDir, { recursive: true });

const result = spawnSync(
  "hdiutil",
  [
    "create",
    "-volname",
    productName,
    "-srcfolder",
    appPath,
    "-ov",
    "-format",
    "UDZO",
    outputPath,
  ],
  {
    cwd: bundleRoot,
    stdio: "inherit",
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`DMG created at: ${outputPath}`);