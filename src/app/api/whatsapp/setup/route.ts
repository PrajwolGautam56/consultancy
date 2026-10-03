import { NextRequest, NextResponse } from "next/server";
import { rateLimit, requireSameOrigin, requireSession } from "@/lib/api-security";
import { whatsappTemplateAccountId } from "@/lib/whatsapp";
import { subscribeVerifiedWhatsAppAccounts } from "@/lib/whatsapp-setup";

type MetaEdge = "phone_numbers" | "message_templates" | "subscribed_apps";
type MetaPhone = { id?: string; display_phone_number?: string };
type MetaTemplate = { status?: string };
type MetaApp = { id?: string; name?: string; override_callback_uri?: string; whatsapp_business_api_data?: { id?: string; name?: string } };
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
  if (error instanceof Error && error.message === "Meta did not confirm the subscription") return "Meta did not confirm the subscription.";
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

async function metaRequest<T>(url: URL, method: "GET" | "POST" = "GET"): Promise<MetaPage<T> & { success?: boolean | "true" }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("WhatsApp token is not configured");
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => null) as (MetaPage<T> & { success?: boolean | "true" }) | null;
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
  const templateAccountId = accountId ?? whatsappTemplateAccountId();
  return {
    accountId: selected, phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    templateAccountId: numericId.test(templateAccountId) ? templateAccountId : "",
  };
}

function subscriptionUrl(accountId: string) {
  return new URL(`https://graph.facebook.com/${graphVersion()}/${accountId}/subscribed_apps`);
}

function appSummaries(apps: MetaApp[]) {
  return apps.map((app) => {
    let overrideCallbackUri: string | undefined;
    try {
      const url = new URL(app.override_callback_uri || "");
      if (url.protocol === "https:" || url.protocol === "http:") overrideCallbackUri = `${url.origin}${url.pathname}`;
    } catch { /* No callback override was configured. */ }
    return {
      id: app.whatsapp_business_api_data?.id || app.id || "",
      name: app.whatsapp_business_api_data?.name || app.name || "",
      ...(overrideCallbackUri ? { overrideCallbackUri } : {}),
    };
  })
    .filter((app) => app.id && app.name);
}

async function diagnoseAccount(accountId: string, phoneId: string) {
  const [phoneResult, appResult, templateResult] = await Promise.allSettled([
    metaCollection<MetaPhone>(accountId, "phone_numbers", "id,display_phone_number"),
    metaCollection<MetaApp>(accountId, "subscribed_apps", ""),
    metaCollection<MetaTemplate>(accountId, "message_templates", "status"),
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
  return {
    accountId, phoneMatches: phones.some((phone) => phone.id === phoneId), phones,
    subscribedApps, subscriptionRecordCount: appResult.status === "fulfilled" ? appResult.value.length : 0,
    templateCount: templates.length, templateStatuses, errors,
  };
}

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (session.role !== "super_admin") return NextResponse.json({ error: "Super administrator access required" }, { status: 403 });
  const requestedId = request.nextUrl.searchParams.get("accountId");
  if (requestedId !== null && !numericId.test(requestedId)) return NextResponse.json({ error: "Invalid WhatsApp account ID" }, { status: 400 });
  const config = accountConfig(requestedId);
  if (!config || !process.env.WHATSAPP_ACCESS_TOKEN) return NextResponse.json({ error: "WhatsApp setup is incomplete" }, { status: 503 });

  const phoneAccountPromise = diagnoseAccount(config.accountId, config.phoneId);
  const templateAccountPromise = config.templateAccountId === config.accountId
    ? phoneAccountPromise
    : config.templateAccountId
      ? diagnoseAccount(config.templateAccountId, config.phoneId)
      : Promise.resolve(null);
  const [phoneAccount, templateAccount] = await Promise.all([phoneAccountPromise, templateAccountPromise]);
  const errors = {
    ...(phoneAccount.errors.phones ? { phones: phoneAccount.errors.phones } : {}),
    ...(phoneAccount.errors.subscriptions ? { subscriptions: phoneAccount.errors.subscriptions } : {}),
    ...(templateAccount?.errors.templates ? { templates: templateAccount.errors.templates } : {}),
    ...(!templateAccount ? { templates: "Template account ID is not configured correctly." } : {}),
  };
  return NextResponse.json({
    accountId: config.accountId, phoneId: config.phoneId, templateAccountId: config.templateAccountId,
    phoneMatches: phoneAccount.phoneMatches,
    phones: phoneAccount.phones, subscribedApps: phoneAccount.subscribedApps,
    subscriptionRecordCount: phoneAccount.subscriptionRecordCount,
    templateCount: templateAccount?.templateCount || 0,
    templateStatuses: templateAccount?.templateStatuses || {}, errors,
    ...(templateAccount && templateAccount.accountId !== config.accountId ? { templateAccountDiagnostics: templateAccount } : {}),
  });
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (session.role !== "super_admin") return NextResponse.json({ error: "Super administrator access required" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const limited = rateLimit(request, "whatsapp-subscribe", 5, 60_000); if (limited) return limited;
  if (request.nextUrl.searchParams.has("accountId")) return NextResponse.json({ error: "Subscription uses the configured WhatsApp account only" }, { status: 400 });
  const config = accountConfig();
  if (!config || !numericId.test(config.phoneId) || !config.templateAccountId || !process.env.WHATSAPP_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Configured WhatsApp accounts, phone ID, or token are missing" }, { status: 503 });
  }

  const outcome = await subscribeVerifiedWhatsAppAccounts(config.accountId, config.templateAccountId, config.phoneId, {
    listPhoneIds: async (accountId) => (await metaCollection<MetaPhone>(accountId, "phone_numbers", "id,display_phone_number")).map((phone) => phone.id || ""),
    subscribe: async (accountId) => {
      const result = await metaRequest<never>(subscriptionUrl(accountId), "POST");
      return result.success === true || result.success === "true";
    },
    listApps: async (accountId) => appSummaries(await metaCollection<MetaApp>(accountId, "subscribed_apps", "")),
    safeError,
  });
  if (outcome.preflightFailed) {
    return NextResponse.json({
      success: false, accounts: outcome.accounts,
      error: "The configured phone must be verified in every account. No subscription was changed.",
    }, { status: outcome.accounts.some((account) => account.error !== "Configured phone ID is not present in this WhatsApp account.") ? 424 : 409 });
  }
  const phoneAccountApps = outcome.accounts.find((account) => account.accountId === config.accountId)?.subscribedApps || [];
  return NextResponse.json({
    success: outcome.success, accounts: outcome.accounts, subscribedApps: phoneAccountApps,
    ...(!outcome.success ? { error: "One or more WhatsApp account subscriptions failed. Check each account below." } : {}),
  }, { status: outcome.success ? 200 : 424 });
}
