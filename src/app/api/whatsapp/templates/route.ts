import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-security";
import { getApprovedWhatsAppTemplates } from "@/lib/whatsapp";

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  try {
    const templates = await getApprovedWhatsAppTemplates();
    return NextResponse.json({ templates, accountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "" });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not load Meta templates",
      accountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    }, { status: 502 });
  }
}
