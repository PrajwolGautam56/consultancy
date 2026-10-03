import assert from "node:assert/strict";
import test from "node:test";
import { subscribeVerifiedWhatsAppAccounts } from "../src/lib/whatsapp-setup.ts";

const operations = (overrides = {}) => ({
  listPhoneIds: async () => ["1389676640891980"],
  subscribe: async () => true,
  listApps: async () => [{ id: "4402025403262004", name: "Aims CRM Integration" }],
  safeError: () => "Meta denied access",
  ...overrides,
});

test("does not subscribe either WABA unless both own the configured phone", async () => {
  const writes = [];
  const outcome = await subscribeVerifiedWhatsAppAccounts("111111", "222222", "1389676640891980", operations({
    listPhoneIds: async (accountId) => accountId === "111111" ? ["1389676640891980"] : [],
    subscribe: async (accountId) => { writes.push(accountId); return true; },
  }));
  assert.equal(outcome.success, false);
  assert.equal(outcome.preflightFailed, true);
  assert.deepEqual(writes, []);
  assert.equal(outcome.accounts[1].phoneVerified, false);
});

test("reports partial failure if the separate template WABA subscription fails", async () => {
  const outcome = await subscribeVerifiedWhatsAppAccounts("111111", "222222", "1389676640891980", operations({
    subscribe: async (accountId) => accountId === "111111",
    safeError: (error) => error.message,
  }));
  assert.equal(outcome.success, false);
  assert.equal(outcome.preflightFailed, false);
  assert.deepEqual(outcome.accounts.map((account) => account.subscriptionAccepted), [true, false]);
  assert.match(outcome.accounts[1].error, /did not confirm/);
});

test("subscribes once when phone and template WABA are the same", async () => {
  const writes = [];
  const outcome = await subscribeVerifiedWhatsAppAccounts("111111", "111111", "1389676640891980", operations({
    subscribe: async (accountId) => { writes.push(accountId); return true; },
  }));
  assert.equal(outcome.success, true);
  assert.deepEqual(writes, ["111111"]);
  assert.deepEqual(outcome.accounts[0].roles, ["phone", "template"]);
});

test("retains accepted status when app-list readback fails", async () => {
  const outcome = await subscribeVerifiedWhatsAppAccounts("111111", "111111", "1389676640891980", operations({
    listApps: async () => { throw new Error("unavailable"); },
  }));
  assert.equal(outcome.success, true);
  assert.equal(outcome.accounts[0].subscriptionAccepted, true);
  assert.match(outcome.accounts[0].warning, /app list could not be refreshed/);
});
