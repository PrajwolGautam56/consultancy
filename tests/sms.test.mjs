import test from "node:test";
import assert from "node:assert/strict";
import { estimateSmsCredits, normalizeSmsPhone, parseSmsProviderResponse, renderSmsTemplate, smsProviderDefaults } from "../src/lib/sms.ts";

test("normalizes common Nepal phone formats", () => {
  assert.equal(normalizeSmsPhone("+977 9841-280-991"), "9841280991");
  assert.equal(normalizeSmsPhone("09841280991"), "9841280991");
  assert.equal(normalizeSmsPhone("9841280991"), "9841280991");
});

test("estimates GSM and Unicode segments", () => {
  assert.deepEqual(estimateSmsCredits("Hello student"), { encoding: "text", units: 13, segments: 1 });
  assert.equal(estimateSmsCredits("a".repeat(161)).segments, 2);
  assert.equal(estimateSmsCredits("नमस्ते").encoding, "unicode");
  assert.equal(estimateSmsCredits("न".repeat(71)).segments, 2);
});

test("renders supported CRM merge fields without interpreting unknown tokens", () => {
  assert.equal(
    renderSmsTemplate("Hello {{ name }}, study {{course}}. {{unknown}}", { name: "Aayush", course: "BBA" }),
    "Hello Aayush, study BBA. {{unknown}}",
  );
});

test("parses plain and nested JSON SMS shoot IDs", () => {
  assert.equal(parseSmsProviderResponse("SMS Pasal", "SMS-SHOOT-ID/abc_123").shootId, "abc_123");
  assert.equal(
    parseSmsProviderResponse("SMS Pasal", JSON.stringify({ response_code: 200, data: { shoot_id: "shoot-456" } })).shootId,
    "shoot-456",
  );
});

test("surfaces the provider rejection message", () => {
  assert.throws(
    () => parseSmsProviderResponse("SMS Pasal", JSON.stringify({ response_code: 400, message: "Invalid route" })),
    /SMS Pasal: Invalid route/,
  );
});

test("normalizes the retired SMS Pasal route and sender values", () => {
  const previousSender = process.env.SMSPASAL_SMS_SENDER_ID;
  const previousRoute = process.env.SMSPASAL_SMS_ROUTE_ID;
  process.env.SMSPASAL_SMS_SENDER_ID = "TN_ALERT";
  process.env.SMSPASAL_SMS_ROUTE_ID = "10305";
  assert.equal(smsProviderDefaults("smspasal").senderId, "TN_Alert");
  assert.equal(smsProviderDefaults("smspasal").routeId, "10259");
  if (previousSender === undefined) delete process.env.SMSPASAL_SMS_SENDER_ID;
  else process.env.SMSPASAL_SMS_SENDER_ID = previousSender;
  if (previousRoute === undefined) delete process.env.SMSPASAL_SMS_ROUTE_ID;
  else process.env.SMSPASAL_SMS_ROUTE_ID = previousRoute;
});
