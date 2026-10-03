import test from "node:test";
import assert from "node:assert/strict";
import { estimateSmsCredits, normalizeSmsPhone, renderSmsTemplate } from "../src/lib/sms.ts";

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
