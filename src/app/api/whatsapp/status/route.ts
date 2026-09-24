import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-security";
import { whatsappConfigured } from "@/lib/whatsapp";

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  return NextResponse.json({ configured: whatsappConfigured(), phoneNumber: process.env.WHATSAPP_DISPLAY_NUMBER || "" });
}
