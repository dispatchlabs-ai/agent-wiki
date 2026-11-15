import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

// A retry can recover its response without storing bearer secrets in plaintext
// or introducing an operator-managed encryption key. The presented refresh
// token has 256 bits of entropy; its stored digest cannot decrypt this envelope.
const key = (token) =>
  createHash("sha256")
    .update("agent-wiki/oauth-replay/v1\0")
    .update(token)
    .digest();

export function sealRefresh(token, grant, response) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(token), iv);
  cipher.setAAD(Buffer.from(grant));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(response), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function openRefresh(token, grant, envelope) {
  const data = Buffer.from(envelope, "base64url");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(token),
    data.subarray(0, 12),
  );
  cipher.setAAD(Buffer.from(grant));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(
      "utf8",
    ),
  );
}
