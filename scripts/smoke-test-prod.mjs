// Quick smoke test for the production bridge.
// Usage: node scripts/smoke-test-prod.mjs
import { spawn } from "node:child_process";

const child = spawn("node", ["apps/bridge/dist/index.js"], {
  stdio: "pipe",
});

child.stderr.on("data", (d) => { process.stderr.write(d); });
child.stdout.on("data", (d) => { process.stderr.write(d); });

setTimeout(async () => {
  const results = [];
  try {
    const health = await fetch("http://127.0.0.1:8787/health");
    results.push(`Health: ${health.status}`);

    const root = await fetch("http://127.0.0.1:8787/");
    const rootBody = await root.text();
    results.push(`Root: ${root.status} ${rootBody.includes("<!DOCTYPE") ? "HTML_OK" : "NOT_HTML"}`);

    const spa = await fetch("http://127.0.0.1:8787/deep/path");
    const spaBody = await spa.text();
    results.push(`SPA fallback: ${spa.status} ${spaBody.includes("<!DOCTYPE") ? "HTML_OK" : "NOT_HTML"}`);

    const api = await fetch("http://127.0.0.1:8787/api/repos");
    results.push(`API without auth: ${api.status}`);
  } catch (e) {
    results.push(`ERROR: ${e.message}`);
  }

  for (const r of results) console.log(r);
  child.kill("SIGTERM");
}, 4000);

child.on("exit", () => process.exit(0));
