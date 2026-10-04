import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { decryptMetaToken, encryptMetaToken, verifyMetaSignature } from "../src/lib/meta.ts";

test("encrypts Meta Page tokens before database storage", () => {
  process.env.META_TOKEN_ENCRYPTION_KEY = "test-only-encryption-secret-with-enough-entropy";
  const original = "EAAB-example-page-access-token";
  const encrypted = encryptMetaToken(original);
  assert.notEqual(encrypted, original);
  assert.equal(encrypted.split(".").length, 3);
  assert.equal(decryptMetaToken(encrypted), original);
});

test("accepts only a valid Meta webhook signature", () => {
  process.env.META_APP_SECRET = "test-app-secret";
  const body = JSON.stringify({ object: "page", entry: [] });
  const signature = `sha256=${crypto.createHmac("sha256", process.env.META_APP_SECRET).update(body).digest("hex")}`;
  assert.equal(verifyMetaSignature(body, signature), true);
  assert.equal(verifyMetaSignature(`${body}x`, signature), false);
  assert.equal(verifyMetaSignature(body, "sha256=bad"), false);
});
