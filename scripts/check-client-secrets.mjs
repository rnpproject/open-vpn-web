import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(".next/static");
async function files(dir) {
  try {
    const found = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, e.name);
      if (e.isDirectory()) found.push(...(await files(target)));
      else found.push(target);
    }
    return found;
  } catch {
    return [];
  }
}
const bad = [];
for (const file of await files(root)) {
  const body = await readFile(file);
  const text = body.toString("utf8");
  if (/VPN_API_KEY|IP_HASH_SALT|NEXT_PUBLIC_VPN_API_KEY/.test(text)) bad.push(file);
  if (process.env.VPN_API_KEY && text.includes(process.env.VPN_API_KEY)) bad.push(file);
}
if (bad.length) {
  console.error(`Server secret reference found in client bundle: ${bad.join(", ")}`);
  process.exit(1);
}
console.log("Client static bundle contains no server secret references.");
