import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Self-service links ("manage your booking").
 * token = HMAC-SHA256(secret, nonce), base64url (256 bit).
 * The database stores the nonce and SHA-256(token): the server can re-create
 * the link for every email, while a database dump alone cannot.
 */
export function createManageToken(secret: string): { nonce: string; token: string; hash: string } {
  const nonce = randomBytes(16).toString("base64url");
  const token = tokenFromNonce(secret, nonce);
  return { nonce, token, hash: hashToken(token) };
}

export function tokenFromNonce(secret: string, nonce: string): string {
  return createHmac("sha256", secret).update(`manage:${nonce}`).digest("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
