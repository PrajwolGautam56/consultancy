import crypto from "crypto";

export function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_VERIFY_TOKEN);
}

export function normalizeWhatsAppPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `977${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("9")) digits = `977${digits}`;
  return digits;
}

export function verifyMetaSignature(rawBody: string, signature: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function sendWhatsApp(payload: Record<string, unknown>) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error("WhatsApp Cloud API is not configured");
  const version = process.env.META_GRAPH_API_VERSION || "v26.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const data = await response.json() as { messages?: { id: string }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "Meta rejected the message");
  return data.messages?.[0]?.id || "";
}
