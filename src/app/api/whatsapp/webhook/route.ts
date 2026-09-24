import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import { Lead } from "@/models/Lead";
import { WhatsAppMessage } from "@/models/WhatsAppMessage";
import { normalizeWhatsAppPhone, verifyMetaSignature } from "@/lib/whatsapp";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ error: "Webhook verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  try {
    const body = JSON.parse(rawBody) as { entry?: { changes?: { value?: { messages?: Array<{ id: string; from: string; timestamp?: string; type?: string; text?: { body?: string }; image?: { caption?: string }; document?: { caption?: string; filename?: string } }>; statuses?: Array<{ id: string; status: string; timestamp?: string; errors?: Array<{ title?: string }> }> } }[] }[] };
    await connectMongo();
    for (const entry of body.entry || []) for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        const waId = normalizeWhatsAppPhone(message.from); const lead = await Lead.findOne({ phone: { $in: [waId, `+${waId}`, waId.startsWith("977") ? waId.slice(3) : waId] }, archivedAt: null }).select("_id").lean() as unknown as null | { _id: unknown };
        const text = message.text?.body || message.image?.caption || message.document?.caption || message.document?.filename || `[${message.type || "message"}]`;
        await WhatsAppMessage.updateOne({ waMessageId: message.id }, { $setOnInsert: { waMessageId: message.id, leadId: lead?._id, waId, direction: "inbound", type: message.type || "text", body: text, status: "received", occurredAt: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date() } }, { upsert: true });
      }
      for (const status of value.statuses || []) await WhatsAppMessage.updateOne({ waMessageId: status.id }, { $set: { status: ["sent", "delivered", "read", "failed"].includes(status.status) ? status.status : "sent", error: status.errors?.map((item) => item.title).filter(Boolean).join(", ") || undefined } });
    }
    return NextResponse.json({ received: true });
  } catch { return NextResponse.json({ received: true }); }
}
