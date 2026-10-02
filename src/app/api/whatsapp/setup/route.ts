import { NextRequest, NextResponse } from "next/server";
import { rateLimit, requireSameOrigin, requireSession } from "@/lib/api-security";

type MetaEdge = "phone_numbers" | "message_templates" | "subscribed_apps";
type MetaPhone = { id?: string; display_phone_number?: string };
type MetaTemplate = { status?: string };
type MetaApp = { id?: string; name?: string; whatsapp_business_api_data?: { id?: string; name?: string } };
type MetaPage<T> = {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
  error?: { code?: number };
};

const numericId = /^\d{5,30}$/;

class MetaRequestError extends Error {
  constructor(readonly status: number, readonly code?: number) { super("Meta request failed"); }
}

function safeError(error: unknown) {
  if (error instanceof MetaRequestError) {
    const code = error.code ? `, code ${error.code}` : "";
    if (error.status === 401 || error.status === 403) return `Meta denied access (HTTP ${error.status}${code}). Check the token's WhatsApp Business permissions.`;
    if (error.status === 429) return "Meta rate limit reached. Try again shortly.";
    return `Meta request failed (HTTP ${error.status}${code}). Check the account ID and token access.`;
  }
  return "Could not reach Meta. Try again shortly.";
}

function graphVersion() {
  const configured = process.env.META_GRAPH_API_VERSION || "v26.0";
  return /^v\d+\.\d+$/.test(configured) ? configured : "v26.0";
}

async function metaRequest<T>(url: URL, method: "GET" | "POST" = "GET"): Promise<MetaPage<T> & { success?: boolean }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("WhatsApp token is not configured");
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => null) as (MetaPage<T> & { success?: boolean }) | null;
  if (!response.ok) throw new MetaRequestError(response.status, result?.error?.code);
  if (!result) throw new Error("Invalid Meta response");
  return result;
}

async function metaCollection<T>(accountId: string, edge: MetaEdge, fields: string) {
  const entries: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`https://graph.facebook.com/${graphVersion()}/${accountId}/${edge}`);
    if (fields) url.searchParams.set("fields", fields);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const result = await metaRequest<T>(url);
    if (!Array.isArray(result.data)) throw new Error("Invalid Meta collection");
    entries.push(...result.data);
    if (!result.paging?.next) return entries;
    const nextAfter = result.paging.cursors?.after;
    if (!nextAfter || nextAfter === after) throw new Error("Invalid Meta pagination");
    after = nextAfter;
  }
  throw new Error("Meta pagination limit reached");
}

function accountConfig(accountId?: string | null) {
  const configuredAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
  const selected = accountId ?? configuredAccountId;
  if (!numericId.test(selected)) return null;
  return { accountId: selected, phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || "" };
}

function subscriptionUrl(accountId: string) {
  return new URL(`https://graph.facebook.com/${graphVersion()}/${accountId}/subscribed_apps`);
}

function appSummaries(apps: MetaApp[]) {
  return apps.map((app) => ({ id: app.whatsapp_business_api_data?.id || app.id || "", name: app.whatsapp_business_api_data?.name || app.name || "" }))
    .filter((app) => app.id && app.name);
}

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (session.role !== "super_admin") return NextResponse.json({ error: "Super administrator access required" }, { status: 403 });
  const requestedId = request.nextUrl.searchParams.get("accountId");
  if (requestedId !== null && !numericId.test(requestedId)) return NextResponse.json({ error: "Invalid WhatsApp account ID" }, { status: 400 });
  const config = accountConfig(requestedId);
  if (!config || !process.env.WHATSAPP_ACCESS_TOKEN) return NextResponse.json({ error: "WhatsApp setup is incomplete" }, { status: 503 });

  const [phoneResult, appResult, templateResult] = await Promise.allSettled([
    metaCollection<MetaPhone>(config.accountId, "phone_numbers", "id,display_phone_number"),
    metaCollection<MetaApp>(config.accountId, "subscribed_apps", ""),
    metaCollection<MetaTemplate>(config.accountId, "message_templates", "status"),
  ]);
  const errors: { phones?: string; subscriptions?: string; templates?: string } = {};
  if (phoneResult.status === "rejected") errors.phones = safeError(phoneResult.reason);
  if (appResult.status === "rejected") errors.subscriptions = safeError(appResult.reason);
  if (templateResult.status === "rejected") errors.templates = safeError(templateResult.reason);
  const phones = phoneResult.status === "fulfilled"
    ? phoneResult.value.filter((phone): phone is Required<MetaPhone> => Boolean(phone.id && phone.display_phone_number)).map((phone) => ({ id: phone.id, displayPhoneNumber: phone.display_phone_number }))
    : [];
  const subscribedApps = appResult.status === "fulfilled" ? appSummaries(appResult.value) : [];
  const templates = templateResult.status === "fulfilled" ? templateResult.value : [];
  const templateStatuses = templates.reduce<Record<string, number>>((counts, template) => {
    const status = typeof template.status === "string" ? template.status : "UNKNOWN";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  return NextResponse.json({
    accountId: config.accountId, phoneId: config.phoneId,
    phoneMatches: phones.some((phone) => phone.id === config.phoneId),
    phones, subscribedApps, subscriptionRecordCount: appResult.status === "fulfilled" ? appResult.value.length : 0,
    templateCount: templates.length, templateStatuses, errors,
  });
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (session.role !== "super_admin") return NextResponse.json({ error: "Super administrator access required" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const limited = rateLimit(request, "whatsapp-subscribe", 5, 60_000); if (limited) return limited;
  if (request.nextUrl.searchParams.has("accountId")) return NextResponse.json({ error: "Subscription uses the configured WhatsApp account only" }, { status: 400 });
  const config = accountConfig();
  if (!config || !numericId.test(config.phoneId) || !process.env.WHATSAPP_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Configured WhatsApp account, phone ID, or token is missing" }, { status: 503 });
  }

  let phones: MetaPhone[];
  try {
    phones = await metaCollection<MetaPhone>(config.accountId, "phone_numbers", "id,display_phone_number");
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 424 });
  }
  if (!phones.some((phone) => phone.id === config.phoneId)) {
    return NextResponse.json({ error: "The configured phone ID does not belong to the configured WhatsApp account" }, { status: 409 });
  }

  try {
    const result = await metaRequest<never>(subscriptionUrl(config.accountId), "POST");
    if (result.success !== true) throw new Error("Meta did not confirm the subscription");
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 424 });
  }

  try {
    const apps = await metaCollection<MetaApp>(config.accountId, "subscribed_apps", "");
    const subscribedApps = appSummaries(apps);
    return NextResponse.json({ success: true, subscribedApps });
  } catch (error) {
    return NextResponse.json({ success: true, subscribedApps: [], warning: safeError(error) });
  }
}
