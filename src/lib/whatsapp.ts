import crypto from "crypto";

export function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_VERIFY_TOKEN);
}

export function whatsappWebhookConfigured() {
  return Boolean(process.env.WHATSAPP_VERIFY_TOKEN && process.env.META_APP_SECRET);
}

export function normalizeWhatsAppPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `977${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("9")) digits = `977${digits}`;
  return digits;
}

/** Match stored numbers even when a student was entered with spaces, dashes or +977. */
export function whatsappPhonePatterns(value: string) {
  const digits = normalizeWhatsAppPhone(value);
  if (!/^\d{8,15}$/.test(digits)) return [];
  const variants = [digits];
  if (digits.startsWith("977") && digits.length === 13) {
    variants.push(digits.slice(3), `0${digits.slice(3)}`);
  }
  return variants.map((phone) => new RegExp(`^\\D*${phone.split("").join("\\D*")}\\D*$`));
}

export function verifyMetaSignature(rawBody: string, signature: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type ApprovedWhatsAppTemplate = {
  name: string; language: string; category: string; parameterCount: number; body: string;
  headerFormat?: string; headerImageUrl?: string;
};

const campaignImageHeaders: Record<string, string> = {
  aims_cee_result_wishes_2026: "https://crm.aimsglobal.com.np/aims-cee-best-wishes-2026.png",
};

export function templateComponents(template: ApprovedWhatsAppTemplate, bodyParameters: string[]) {
  const components: Array<Record<string, unknown>> = [];
  if (template.headerFormat && template.headerFormat !== "TEXT") {
    if (template.headerFormat !== "IMAGE" || !template.headerImageUrl) {
      throw new Error(`The ${template.name} template has an unsupported media header`);
    }
    components.push({ type: "header", parameters: [{ type: "image", image: { link: template.headerImageUrl } }] });
  }
  if (bodyParameters.length) components.push({ type: "body", parameters: bodyParameters.map((value) => ({ type: "text", text: value })) });
  return components;
}

let templateCache: { accountId: string; expiresAt: number; templates: ApprovedWhatsAppTemplate[] } | null = null;

export function whatsappTemplateAccountId() {
  return process.env.WHATSAPP_TEMPLATE_ACCOUNT_ID?.trim() || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || "";
}

export async function getApprovedWhatsAppTemplates(): Promise<ApprovedWhatsAppTemplate[]> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const accountId = whatsappTemplateAccountId();
  if (!token || !/^\d{5,30}$/.test(accountId)) throw new Error("WhatsApp templates are not configured");
  if (templateCache?.accountId === accountId && templateCache.expiresAt > Date.now()) return templateCache.templates;
  const version = process.env.META_GRAPH_API_VERSION || "v26.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${accountId}/message_templates?fields=name,status,category,language,components&limit=100`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  const data = await response.json() as {
    data?: Array<{ name: string; status: string; category: string; language: string; components?: Array<{ type?: string; text?: string; format?: string }> }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(data.error?.message || `Meta template request failed (${response.status})`);
  const templates = (data.data || []).filter((item) => item.status === "APPROVED").map((item) => {
    const body = item.components?.find((component) => component.type === "BODY")?.text || "";
    const headerFormat = item.components?.find((component) => component.type === "HEADER")?.format;
    const parameterCount = Math.max(0, ...Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (match) => Number(match[1])));
    return { name: item.name, language: item.language, category: item.category, parameterCount, body, headerFormat, headerImageUrl: headerFormat === "IMAGE" ? campaignImageHeaders[item.name] : undefined };
  });
  templateCache = { accountId, expiresAt: Date.now() + 60_000, templates };
  return templates;
}

export function renderWhatsAppTemplate(body: string, parameters: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_, index: string) => parameters[Number(index) - 1] || "");
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
  const messageId = data.messages?.[0]?.id;
  if (!messageId) throw new Error("Meta accepted the request without a message ID");
  return messageId;
}
