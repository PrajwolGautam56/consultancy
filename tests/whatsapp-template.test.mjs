import assert from "node:assert/strict";
import test from "node:test";
import { templateComponents } from "../src/lib/whatsapp.ts";

test("CEE wishes template includes its image header and personalized name", () => {
  assert.deepEqual(templateComponents({
    name: "aims_cee_result_wishes_2026",
    language: "en",
    category: "MARKETING",
    parameterCount: 1,
    body: "Hi {{1}}",
    headerFormat: "IMAGE",
    headerImageUrl: "https://crm.aimsglobal.com.np/aims-cee-best-wishes-2026.png",
  }, ["Anjali"]), [
    { type: "header", parameters: [{ type: "image", image: { link: "https://crm.aimsglobal.com.np/aims-cee-best-wishes-2026.png" } }] },
    { type: "body", parameters: [{ type: "text", text: "Anjali" }] },
  ]);
});

test("unsupported image header is rejected before sending", () => {
  assert.throws(() => templateComponents({
    name: "unknown_image_template", language: "en", category: "MARKETING", parameterCount: 0,
    body: "Hello", headerFormat: "IMAGE",
  }, []), /unsupported media header/);
});
