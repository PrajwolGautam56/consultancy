import crypto from "crypto";

export type MetaPlatform = "facebook" | "instagram";

export function metaGraphVersion() {
  return process.env.META_GRAPH_API_VERSION?.trim() || "v26.0";
}

export function metaConnectionConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_PAGE_VERIFY_TOKEN);
}

function encryptionKey() {
  const secret = process.env.META_TOKEN_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) throw new Error("META_TOKEN_ENCRYPTION_KEY is not configured");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptMetaToken(token: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptMetaToken(value: string) {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Stored Meta token is invalid");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export async function metaGraph<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `https://graph.facebook.com/${metaGraphVersion()}/${path.replace(/^\//, "")}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string; code?: number } };
  if (!response.ok || data.error) throw new Error(data.error?.message || `Meta returned HTTP ${response.status}`);
  return data;
}

export function verifyMetaSignature(raw: string, signature: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function metaRedirectUri(origin: string) {
  return process.env.META_OAUTH_REDIRECT_URI?.trim() || `${origin}/api/meta/callback`;
}
