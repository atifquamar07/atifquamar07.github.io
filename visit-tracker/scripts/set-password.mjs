// Sets the dashboard password without writing it anywhere: you type it (hidden), and only a
// salted PBKDF2 hash is stored.
//   npm run password          -> Cloudflare secret DASHBOARD_PASSWORD_HASH (the live dashboard)
//   npm run password:local    -> .dev.vars (local testing with `npm run dev`)
import { spawnSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Must match the Worker's check, which accepts at most 100,000 (Cloudflare's PBKDF2 limit).
const ITERATIONS = 50000;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const local = process.argv.includes("--local");

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Reads a line without echoing it. When input is piped (not a terminal), reads the first line instead.
function promptHidden(question) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => (data += chunk));
      stdin.on("end", () => resolve(data.split(/\r?\n/)[0]));
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    let value = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        value = ch === "\u007f" || ch === "\b" ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on("data", onData);
  });
}

const password = await promptHidden("Dashboard password: ");
if (password.length < 8) fail("Use at least 8 characters.");
if (process.stdin.isTTY && (await promptHidden("Type it again: ")) !== password) fail("The two entries don't match. Nothing was changed.");

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
const value = `pbkdf2-sha256:${ITERATIONS}:${salt.toString("base64")}:${hash.toString("base64")}`;

if (local) {
  const file = path.join(root, ".dev.vars");
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : [];
  const keep = lines.filter((line) => !/^(DASHBOARD_PASSWORD_HASH|DASHBOARD_PASSWORD|ALLOWED_ORIGINS)=/.test(line));
  // Local copies of the site (docker compose: localhost:8080) may use the local dashboard.
  keep.push(`ALLOWED_ORIGINS=https://www.atifquamar.com,http://localhost:8080,http://127.0.0.1:8080`, `DASHBOARD_PASSWORD_HASH=${value}`);
  fs.writeFileSync(file, `${keep.join("\n")}\n`);
  console.log("Saved the password hash to visit-tracker/.dev.vars (restart `npm run dev` to use it).");
} else {
  const result = spawnSync("npx", ["wrangler", "secret", "put", "DASHBOARD_PASSWORD_HASH"], {
    cwd: root,
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) fail("Could not save the secret to Cloudflare. Are you logged in (npx wrangler login)?");
  console.log("Password set. Everyone signed in to the dashboard has been signed out.");
}
