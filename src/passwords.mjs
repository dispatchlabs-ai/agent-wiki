import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { WikiError } from "./errors.mjs";
/** @type {(password: string, salt: string, length: number, options: import("node:crypto").ScryptOptions) => Promise<Buffer>} */
const derive = promisify(scrypt);
const parameters = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
let running = 0;
async function key(password, salt) {
  if (running >= 2)
    throw new WikiError(
      "AUTH_BUSY",
      "Sign-in is busy. Try again shortly.",
      429,
    );
  running++;
  try {
    return await derive(password, salt, 64, parameters);
  } finally {
    running--;
  }
}
export function validatePassword(password) {
  if (
    typeof password !== "string" ||
    [...password].length < 15 ||
    password.length > 1024
  )
    throw new WikiError(
      "INVALID_PASSWORD",
      "Use a password between 15 and 1024 characters.",
      400,
    );
}
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString("hex");
  return `scrypt:131072:8:1:${salt}:${(await key(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length > 1024) return false;
  const valid =
    typeof stored === "string" &&
    /^scrypt:131072:8:1:[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored);
  const parts = valid
    ? stored.split(":")
    : ["", "", "", "", "0".repeat(32), "0".repeat(128)];
  const actual = await key(password, parts[4]);
  return timingSafeEqual(actual, Buffer.from(parts[5], "hex")) && valid;
}
