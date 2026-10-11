import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const tokenNames = ["bg", "surface", "ink", "muted", "primary", "sky", "cyan", "warm", "danger"];
const tokens = Object.fromEntries(
  tokenNames.map((name) => {
    const match = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`));
    if (!match) throw new Error(`Missing hex token --${name}`);
    return [name, match[1]];
  }),
);

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((part) => parseInt(part, 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function ratio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const pairs = [
  ["ink", "bg", 4.5],
  ["ink", "surface", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "bg", 4.5],
  ["surface", "primary", 4.5],
  ["primary", "bg", 4.5],
  ["primary", "surface", 4.5],
  ["ink", "warm", 4.5],
  ["ink", "cyan", 4.5],
  ["ink", "sky", 3],
  ["danger", "bg", 4.5],
  ["danger", "surface", 4.5],
];
let failed = false;
for (const [foreground, background, minimum] of pairs) {
  const value = ratio(tokens[foreground], tokens[background]);
  const ok = value >= minimum;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${foreground} on ${background}: ${value.toFixed(2)}:1 (min ${minimum}:1)`,
  );
  failed ||= !ok;
}
if (failed) process.exitCode = 1;
