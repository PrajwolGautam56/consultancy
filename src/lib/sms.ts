export type SmsProviderId = "samaya" | "smspasal";

export type SmsBalance = {
  routeId: string;
  route: string;
  balance: number;
};

export type SmsLastTransaction = {
  submissionTime: string;
  chargePerSms: number;
  totalCreditsDeducted: number;
  smsText: string;
} | null;

export type SmsSendInput = {
  phone: string;
  message: string;
  senderId: string;
  routeId?: string;
  campaignId?: string;
  scheduledAt?: Date;
};

export type SmsSendResult = { shootId: string; rawResponse: string };
export type SmsDelivery = { phone: string; status: string; description: string };

const PROVIDERS: Record<SmsProviderId, {
  name: string;
  smsUrl: string;
  miscUrl: string;
  lastUrl: string;
  keyEnvironment: string;
  senderEnvironment: string;
  routeEnvironment: string;
  campaignEnvironment: string;
  defaultRouteId: string;
  defaultCampaignId: string;
  defaultSenderId: string;
}> = {
  samaya: {
    name: "Samaya SMS",
    smsUrl: "https://samayasms.com.np/smsapi/index.php",
    miscUrl: "https://samayasms.com.np/miscapi",
    lastUrl: "https://samayasms.com.np/lasttran/index.php",
    keyEnvironment: "SAMAYA_SMS_API_KEY",
    senderEnvironment: "SAMAYA_SMS_SENDER_ID",
    routeEnvironment: "SAMAYA_SMS_ROUTE_ID",
    campaignEnvironment: "SAMAYA_SMS_CAMPAIGN_ID",
    defaultRouteId: "10255",
    defaultCampaignId: "9778",
    defaultSenderId: "Bit_Alert",
  },
  smspasal: {
    name: "SMS Pasal",
    smsUrl: "https://sms.smspasal.com/smsapi/index.php",
    miscUrl: "https://sms.smspasal.com/miscapi",
    lastUrl: "https://sms.smspasal.com/lasttran/index.php",
    keyEnvironment: "SMSPASAL_SMS_API_KEY",
    senderEnvironment: "SMSPASAL_SMS_SENDER_ID",
    routeEnvironment: "SMSPASAL_SMS_ROUTE_ID",
    campaignEnvironment: "SMSPASAL_SMS_CAMPAIGN_ID",
    // This account's active SMS Pasal route is returned by the balance API as
    // 10259. Keep this fallback aligned with the previously working Kritech
    // integration; the status endpoint will still prefer the live route list.
    defaultRouteId: "10259",
    defaultCampaignId: "9835",
    defaultSenderId: "TN_Alert",
  },
};

function providerConfig(provider: SmsProviderId) {
  return PROVIDERS[provider];
}

function providerKey(provider: SmsProviderId) {
  return process.env[providerConfig(provider).keyEnvironment]?.trim() || "";
}

export function smsConfigured(provider: SmsProviderId = "samaya") {
  return Boolean(providerKey(provider));
}

export function smsProviderDefaults(provider: SmsProviderId = "samaya") {
  const config = providerConfig(provider);
  const configuredSender = process.env[config.senderEnvironment]?.trim() || config.defaultSenderId;
  const configuredRoute = process.env[config.routeEnvironment]?.trim() || config.defaultRouteId;
  return {
    id: provider,
    name: config.name,
    configured: smsConfigured(provider),
    senderId: provider === "smspasal" && /^TN_ALERT$/i.test(configuredSender) ? config.defaultSenderId : configuredSender,
    routeId: provider === "smspasal" && configuredRoute === "10305" ? config.defaultRouteId : configuredRoute,
    campaignId: process.env[config.campaignEnvironment]?.trim() || config.defaultCampaignId,
  };
}

function safeProviderError(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (/^ERR:/i.test(text)) return text.replace(/^ERR:\s*/i, "").slice(0, 240);
  return fallback;
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function parseSmsProviderResponse(providerName: string, responseText: string): SmsSendResult {
  const raw = responseText.trim();
  if (/^ERR:/i.test(raw)) throw new Error(safeProviderError(raw, `${providerName} rejected the request`));

  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { /* Some provider responses are plain text. */ }
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const data = record?.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : null;
  const resultText = typeof parsed === "string" ? parsed : raw;
  const searchable = record ? JSON.stringify(record) : resultText;
  const responseCode = Number(record?.response_code ?? record?.status_code ?? 0);
  const providerError = stringValue(record?.error)
    || (responseCode >= 400 ? stringValue(record?.message) || `request rejected (${responseCode})` : "");
  if (providerError) throw new Error(`${providerName}: ${providerError}`.slice(0, 500));

  const explicit = stringValue(record?.shoot_id)
    || stringValue(record?.shootId)
    || stringValue(record?.sms_shoot_id)
    || stringValue(data?.shoot_id)
    || stringValue(data?.shootId);
  const match = resultText.match(/SMS-SHOOT-ID[\/":\s]+\{?([A-Za-z0-9_-]+)\}?/i)
    || searchable.match(/SMS-SHOOT-ID[\\/":\s]+\{?([A-Za-z0-9_-]+)\}?/i);
  const shootId = (explicit || match?.[1] || "")
    .replace(/^SMS-SHOOT-ID\//i, "")
    .replace(/[{}]/g, "")
    .trim();
  if (!shootId) {
    const message = stringValue(record?.message) || stringValue(record?.response);
    throw new Error((message
      ? `${providerName}: ${message}`
      : `${providerName} returned an unexpected response: ${raw.slice(0, 240) || "empty response"}`).slice(0, 500));
  }
  return { shootId, rawResponse: raw.slice(0, 500) };
}

async function providerFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`SMS provider returned HTTP ${response.status}`);
  if (/^ERR:/i.test(text.trim())) throw new Error(safeProviderError(text, "SMS provider rejected the request"));
  return text;
}

export function normalizeSmsPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00977")) digits = digits.slice(2);
  if (digits.startsWith("977") && digits.length === 13) digits = digits.slice(3);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return digits;
}

const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""),
);
const GSM_EXTENDED = new Set("^{}\\[~]|€".split(""));

export function smsMessageUnits(message: string) {
  let units = 0;
  for (const character of message) {
    if (GSM_BASIC.has(character)) units += 1;
    else if (GSM_EXTENDED.has(character)) units += 2;
    else return { encoding: "unicode" as const, units: Array.from(message).length };
  }
  return { encoding: "text" as const, units };
}

export function estimateSmsCredits(message: string) {
  const measure = smsMessageUnits(message);
  const single = measure.encoding === "text" ? 160 : 70;
  const joined = measure.encoding === "text" ? 153 : 67;
  const segments = measure.units <= single ? 1 : Math.ceil(measure.units / joined);
  return { ...measure, segments };
}

export function renderSmsTemplate(template: string, recipient: Record<string, string>) {
  return template.replace(/\{\{\s*(name|phone|country|course|university|counsellor)\s*\}\}/gi, (_, key: string) => recipient[key.toLowerCase()] || "");
}

export async function getSmsBalances(provider: SmsProviderId): Promise<SmsBalance[]> {
  const config = providerConfig(provider);
  const key = providerKey(provider);
  if (!key) throw new Error(`${config.name} is not configured`);
  const text = await providerFetch(`${config.miscUrl}/${encodeURIComponent(key)}/getBalance/true/`);
  let data: Array<{ ROUTE_ID?: string; ROUTE?: string; BALANCE?: string | number }>;
  try { data = JSON.parse(text); } catch { throw new Error(`${config.name} returned an unreadable balance response`); }
  if (!Array.isArray(data)) throw new Error(`${config.name} returned an invalid balance response`);
  return data.map((item) => ({
    routeId: String(item.ROUTE_ID || ""), route: String(item.ROUTE || "Unknown route"),
    balance: Number(item.BALANCE || 0),
  })).filter((item) => item.routeId && Number.isFinite(item.balance));
}

export async function getSmsLastTransaction(provider: SmsProviderId): Promise<SmsLastTransaction> {
  const config = providerConfig(provider);
  const key = providerKey(provider);
  if (!key) throw new Error(`${config.name} is not configured`);
  const text = await providerFetch(`${config.lastUrl}?key=${encodeURIComponent(key)}`);
  let result: { response_code?: number; data?: { submission_time?: string; charges_per_sms?: string | number; total_credits_deducted?: string | number; sms_text?: string } };
  try { result = JSON.parse(text); } catch { throw new Error(`${config.name} returned an unreadable transaction response`); }
  if (result.response_code !== 200 || !result.data) return null;
  return {
    submissionTime: String(result.data.submission_time || ""),
    chargePerSms: Number(result.data.charges_per_sms || 0),
    totalCreditsDeducted: Number(result.data.total_credits_deducted || 0),
    smsText: String(result.data.sms_text || ""),
  };
}

export async function sendSms(provider: SmsProviderId, input: SmsSendInput): Promise<SmsSendResult> {
  const config = providerConfig(provider);
  const key = providerKey(provider);
  if (!key) throw new Error(`${config.name} is not configured`);
  const phone = normalizeSmsPhone(input.phone);
  if (!/^9\d{9}$/.test(phone)) throw new Error("A valid Nepal mobile number is required");
  const estimate = estimateSmsCredits(input.message);
  const senderId = provider === "smspasal" && /^TN_ALERT$/i.test(input.senderId) ? config.defaultSenderId : input.senderId;
  const routeId = provider === "smspasal" && input.routeId === "10305" ? config.defaultRouteId : input.routeId;
  const body = new URLSearchParams({
    key, type: estimate.encoding, contacts: phone, senderid: senderId,
    msg: input.message, responsetype: "json",
  });
  if (routeId) body.set("routeid", routeId);
  if (input.campaignId) body.set("campaign", input.campaignId);
  if (input.scheduledAt) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: process.env.SMS_TIME_ZONE || "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(input.scheduledAt).reduce<Record<string, string>>((values, part) => ({ ...values, [part.type]: part.value }), {});
    const local = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    body.set("time", local);
  }
  const text = await providerFetch(config.smsUrl, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  return parseSmsProviderResponse(config.name, text);
}

export async function getSmsDeliveryReport(provider: SmsProviderId, shootId: string): Promise<SmsDelivery[]> {
  const config = providerConfig(provider);
  const key = providerKey(provider);
  if (!key) throw new Error(`${config.name} is not configured`);
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(shootId)) throw new Error("Invalid SMS shoot ID");
  const text = await providerFetch(`${config.miscUrl}/${encodeURIComponent(key)}/getDLR/${encodeURIComponent(shootId)}`);
  let data: Array<{ MSISDN?: string; DLR?: string; DESC?: string }>;
  try { data = JSON.parse(text); } catch { throw new Error(`${config.name} returned an unreadable delivery report`); }
  if (!Array.isArray(data)) throw new Error(`${config.name} returned an invalid delivery report`);
  return data.map((item) => ({ phone: normalizeSmsPhone(String(item.MSISDN || "")), status: String(item.DLR || "Unknown"), description: String(item.DESC || "") }));
}
