import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
await mkdir(path.join(root, ".next/standalone/.next"), { recursive: true });
await cp(path.join(root, ".next/static"), path.join(root, ".next/standalone/.next/static"), {
  recursive: true,
  force: true,
});
try {
  await cp(path.join(root, "public"), path.join(root, ".next/standalone/public"), {
    recursive: true,
    force: true,
  });
} catch {
  /* Public assets are optional. */
}
console.log("Standalone static and public assets copied.");
