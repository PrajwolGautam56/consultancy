import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-security";
import { getApprovedWhatsAppTemplates, whatsappTemplateAccountId } from "@/lib/whatsapp";

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  try {
    const templates = await getApprovedWhatsAppTemplates();
    return NextResponse.json({ templates, accountId: whatsappTemplateAccountId() });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Could not load Meta templates",
      accountId: whatsappTemplateAccountId(),
    }, { status: 424 });
  }
}
