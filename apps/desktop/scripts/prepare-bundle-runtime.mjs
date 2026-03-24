import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const tauriRoot = path.join(desktopRoot, "src-tauri");
const bundleResourcesRoot = path.join(tauriRoot, "bundle-resources");
const workspaceBundleRoot = path.join(bundleResourcesRoot, "workspace");
const runtimeBundleRoot = path.join(bundleResourcesRoot, "runtime", "node");
const runtimeNodeBinaryBundlePath = path.join(runtimeBundleRoot, "bin", "node");
const bridgeBundleRoot = path.join(workspaceBundleRoot, "apps", "bridge");
const bridgeDeployRoot = path.join(bundleResourcesRoot, ".bridge-deploy");

const bridgeDistSource = path.join(repoRoot, "apps", "bridge", "dist");
const webDistSource = path.join(repoRoot, "apps", "web", "dist");

function requirePathExists(targetPath, label) {
  if (!existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath}`);
  }
}

function resolveBundledNodeBinary() {
  const explicitDir = process.env.JOUDO_BUNDLED_NODE_DIR?.trim();
  if (explicitDir) {
    return path.resolve(explicitDir, "bin", "node");
  }

  const explicitBinary = process.env.JOUDO_BUNDLED_NODE_BINARY?.trim();
  if (explicitBinary) {
    return path.resolve(explicitBinary);
  }

  return realpathSync(process.execPath);
}

function resolveBundledNodeRoot(nodeBinaryPath) {
  const realBinaryPath = realpathSync(nodeBinaryPath);
  const binaryName = path.basename(realBinaryPath);
  const binDir = path.dirname(realBinaryPath);

  if (binaryName !== "node" || path.basename(binDir) !== "bin") {
    throw new Error(
      `Cannot infer a portable Node runtime root from ${realBinaryPath}. Set JOUDO_BUNDLED_NODE_DIR to a Node installation directory containing bin/node.`,
    );
  }

  const runtimeRoot = path.dirname(binDir);
  requirePathExists(path.join(runtimeRoot, "bin", "node"), "Bundled Node binary");
  return runtimeRoot;
}

function readNodeVersion(nodeBinaryPath) {
  const result = spawnSync(nodeBinaryPath, ["--version"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Failed to read bundled Node version from ${nodeBinaryPath}`);
  }

  return result.stdout.trim();
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

async function hoistScopedPackages(sourceScopeDir, targetScopeDir) {
  await mkdir(targetScopeDir, { recursive: true });

  for (const entry of await readdir(sourceScopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sourcePath = path.join(sourceScopeDir, entry.name);
    const targetPath = path.join(targetScopeDir, entry.name);
    if (existsSync(targetPath)) {
      continue;
    }

    await cp(sourcePath, targetPath, {
      recursive: true,
      force: true,
      dereference: true,
    });
  }
}

async function hoistPnpmVirtualStore(nodeModulesRoot) {
  const virtualStoreRoot = path.join(nodeModulesRoot, ".pnpm");
  if (!existsSync(virtualStoreRoot)) {
    return;
  }

  for (const entry of await readdir(virtualStoreRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageNodeModulesRoot = path.join(virtualStoreRoot, entry.name, "node_modules");
    if (!existsSync(packageNodeModulesRoot)) {
      continue;
    }

    for (const packageEntry of await readdir(packageNodeModulesRoot, { withFileTypes: true })) {
      if (!packageEntry.isDirectory()) {
        continue;
      }

      if (packageEntry.name === ".bin") {
        continue;
      }

      const sourcePath = path.join(packageNodeModulesRoot, packageEntry.name);
      const targetPath = path.join(nodeModulesRoot, packageEntry.name);

      if (packageEntry.name.startsWith("@")) {
        await hoistScopedPackages(sourcePath, targetPath);
        continue;
      }

      if (existsSync(targetPath)) {
        continue;
      }

      await cp(sourcePath, targetPath, {
        recursive: true,
        force: true,
        dereference: true,
      });
    }
  }
}

async function pruneBundledBridge(bridgeRoot) {
  await rm(path.join(bridgeRoot, "node_modules", ".pnpm"), {
    recursive: true,
    force: true,
  });

  await rm(path.join(bridgeRoot, "src"), {
    recursive: true,
    force: true,
  });

  const currentPlatformDir = `${process.platform}-${process.arch}`;
  const copilotRoot = path.join(bridgeRoot, "node_modules", "@github", "copilot");

  for (const relativeDir of ["prebuilds", path.join("ripgrep", "bin")]) {
    const absoluteDir = path.join(copilotRoot, relativeDir);
    if (!existsSync(absoluteDir)) {
      continue;
    }

    for (const entry of await readdir(absoluteDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === currentPlatformDir) {
        continue;
      }

      await rm(path.join(absoluteDir, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
}

async function main() {
  requirePathExists(bridgeDistSource, "Bridge dist");
  requirePathExists(path.join(bridgeDistSource, "index.js"), "Bridge entry");
  requirePathExists(webDistSource, "Web dist");
  requirePathExists(path.join(webDistSource, "index.html"), "Web entry");

  const nodeBinaryPath = resolveBundledNodeBinary();
  requirePathExists(nodeBinaryPath, "Bundled Node binary");

  const nodeRuntimeRoot = resolveBundledNodeRoot(nodeBinaryPath);
  const nodeVersion = readNodeVersion(path.join(nodeRuntimeRoot, "bin", "node"));

  await rm(bundleResourcesRoot, { recursive: true, force: true });

  await mkdir(path.join(workspaceBundleRoot, "apps"), { recursive: true });
  await mkdir(path.join(workspaceBundleRoot, "apps", "web"), { recursive: true });
  await mkdir(path.dirname(runtimeNodeBinaryBundlePath), { recursive: true });

  runCommand(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@joudo/bridge",
      "deploy",
      "--legacy",
      "--prod",
      bridgeDeployRoot,
    ],
    repoRoot,
  );

  await cp(bridgeDeployRoot, bridgeBundleRoot, {
    recursive: true,
    force: true,
    dereference: true,
  });

  await hoistPnpmVirtualStore(path.join(bridgeBundleRoot, "node_modules"));
  await pruneBundledBridge(bridgeBundleRoot);

  await rm(bridgeDeployRoot, { recursive: true, force: true });

  await cp(path.join(nodeRuntimeRoot, "bin", "node"), runtimeNodeBinaryBundlePath, {
    force: true,
    dereference: true,
  });

  await cp(webDistSource, path.join(workspaceBundleRoot, "apps", "web", "dist"), {
    recursive: true,
    force: true,
    dereference: true,
  });

  const desktopPackage = JSON.parse(
    await readFile(path.join(desktopRoot, "package.json"), "utf8"),
  );

  const manifest = {
    schemaVersion: 1,
    desktopVersion: desktopPackage.version,
    nodeVersion,
    runtimeDir: "runtime/node",
    workspaceDir: "workspace",
    files: {
      nodeBinary: "runtime/node/bin/node",
      bridgeDir: "workspace/apps/bridge",
      bridgeEntry: "workspace/apps/bridge/dist/index.js",
      webIndex: "workspace/apps/web/dist/index.html",
    },
  };

  await writeFile(
    path.join(bundleResourcesRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  await writeFile(path.join(bundleResourcesRoot, ".gitkeep"), "keep\n", "utf8");

  console.log(`Bundled Node runtime prepared: ${nodeVersion}`);
  console.log(`Runtime source: ${path.join(nodeRuntimeRoot, "bin", "node")}`);
  console.log(`Bundle resources: ${bundleResourcesRoot}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});