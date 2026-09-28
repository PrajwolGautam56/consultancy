import { NextRequest, NextResponse } from "next/server";
import { isPrivileged, requireSession } from "@/lib/api-security";

type MetaComponent = { type?: string; text?: string };
type MetaTemplate = { name: string; status: string; category: string; language: string; components?: MetaComponent[] };

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const accountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const version = process.env.META_GRAPH_API_VERSION || "v26.0";
  if (!token || !accountId) return NextResponse.json({ error: "WhatsApp templates are not configured" }, { status: 503 });
  const response = await fetch(`https://graph.facebook.com/${version}/${accountId}/message_templates?fields=name,status,category,language,components&limit=100`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const data = await response.json() as { data?: MetaTemplate[]; error?: { message?: string } };
  if (!response.ok) return NextResponse.json({ error: data.error?.message || "Could not load Meta templates" }, { status: response.status });
  const templates = (data.data || []).filter((template) => template.status === "APPROVED").map((template) => {
    const body = template.components?.find((component) => component.type === "BODY")?.text || "";
    const parameterCount = Math.max(0, ...Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (match) => Number(match[1])));
    return { name: template.name, language: template.language, category: template.category, parameterCount };
  });
  return NextResponse.json({ templates });
}
