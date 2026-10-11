import { randomBytes, scrypt } from "node:crypto";

const N = 32_768;
const r = 8;
const p = 1;
const keyLength = 64;
const maxmem = 64 * 1024 * 1024;

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      reject(new Error("Jalankan perintah ini dari terminal interaktif."));
      return;
    }
    let value = "";
    process.stdout.write(prompt);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();

    const finish = (error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish(new Error("Dibatalkan."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
        } else if (character >= " " && value.length < 256) {
          value += character;
        }
      }
    };
    input.on("data", onData);
  });
}

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N, r, p, maxmem }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

try {
  const password = await readHidden("Password admin baru: ");
  const confirmation = await readHidden("Ulangi password admin: ");
  if (password !== confirmation) throw new Error("Password tidak sama.");
  if (password.length < 12) throw new Error("Gunakan password minimal 12 karakter.");

  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt);
  const sessionSecret = randomBytes(32).toString("hex");
  console.log(
    `ADMIN_PASSWORD_HASH=scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${hash.toString("base64url")}`,
  );
  console.log(`ADMIN_SESSION_SECRET=${sessionSecret}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Gagal membuat hash.");
  process.exitCode = 1;
}
