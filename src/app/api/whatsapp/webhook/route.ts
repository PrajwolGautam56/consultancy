import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import { Lead } from "@/models/Lead";
import { WhatsAppMessage } from "@/models/WhatsAppMessage";
import { normalizeWhatsAppPhone, verifyMetaSignature, whatsappPhonePatterns } from "@/lib/whatsapp";

type MetaMedia = { id?: string; mime_type?: string; caption?: string; filename?: string };
type MetaIncoming = {
  id?: string; from?: string; timestamp?: string; type?: string;
  text?: { body?: string }; image?: MetaMedia; video?: MetaMedia; audio?: MetaMedia;
  document?: MetaMedia; sticker?: MetaMedia;
  button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  location?: { name?: string; address?: string; latitude?: number; longitude?: number };
  reaction?: { emoji?: string };
};
type MetaStatus = {
  id?: string; recipient_id?: string; status?: string; timestamp?: string;
  errors?: Array<{ title?: string; message?: string }>;
};
type MetaValue = {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: MetaIncoming[];
  statuses?: MetaStatus[];
};
type MetaWebhook = { entry?: Array<{ changes?: Array<{ value?: MetaValue }> }> };

function eventDate(timestamp?: string) {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

function describeMessage(message: MetaIncoming) {
  const media = message.image || message.video || message.audio || message.document || message.sticker;
  const kind = message.type || "message";
  const body = message.text?.body || media?.caption || media?.filename || message.button?.text ||
    message.interactive?.button_reply?.title || message.interactive?.list_reply?.title ||
    message.location?.name || message.location?.address || message.reaction?.emoji ||
    (message.location ? `${message.location.latitude}, ${message.location.longitude}` : "") || `[${kind}]`;
  return { type: kind, body: body.slice(0, 5000), mediaId: media?.id, mimeType: media?.mime_type };
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ error: "Webhook verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: MetaWebhook;
  try { body = JSON.parse(rawBody) as MetaWebhook; }
  catch { return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 }); }

  try {
    await connectMongo();
    for (const entry of body.entry || []) for (const change of entry.changes || []) {
      const value = change.value || {};
      // A Meta app can be subscribed to both a test number and the production WABA.
      if (value.metadata?.phone_number_id && value.metadata.phone_number_id !== process.env.WHATSAPP_PHONE_NUMBER_ID) continue;

      for (const message of value.messages || []) {
        if (!message.id || !message.from) continue;
        const waId = normalizeWhatsAppPhone(message.from);
        const patterns = whatsappPhonePatterns(waId);
        if (!patterns.length) continue;
        const lead = await Lead.findOne({ phone: { $in: patterns }, archivedAt: null }).select("_id").lean() as unknown as { _id: unknown } | null;
        const senderName = value.contacts?.find((contact) => normalizeWhatsAppPhone(contact.wa_id || "") === waId)?.profile?.name?.trim().slice(0, 120);
        const content = describeMessage(message);
        await WhatsAppMessage.updateOne(
          { waMessageId: message.id },
          { $setOnInsert: {
            waMessageId: message.id, leadId: lead?._id, waId, direction: "inbound",
            ...content, senderName, status: "received", occurredAt: eventDate(message.timestamp),
          } },
          { upsert: true },
        );
      }

      for (const receipt of value.statuses || []) {
        if (!receipt.id || !receipt.status || !["sent", "delivered", "read", "failed"].includes(receipt.status)) continue;
        const waId = normalizeWhatsAppPhone(receipt.recipient_id || "");
        if (!/^\d{8,15}$/.test(waId)) {
          // The original send record can still exist even if a receipt omits recipient_id.
          if (!await WhatsAppMessage.exists({ waMessageId: receipt.id })) continue;
        } else {
          await WhatsAppMessage.updateOne(
            { waMessageId: receipt.id },
            { $setOnInsert: {
              waMessageId: receipt.id, waId, direction: "outbound", type: "text",
              body: "", status: "queued", occurredAt: eventDate(receipt.timestamp),
            } },
            { upsert: true },
          );
        }
        // Meta receipts may arrive out of order. Never replace read/delivered with sent.
        const eligible: Record<string, string[]> = {
          sent: ["queued", "sent"], failed: ["queued", "sent", "failed"],
          delivered: ["queued", "sent", "failed", "delivered"],
          read: ["queued", "sent", "failed", "delivered", "read"],
        };
        const error = receipt.errors?.map((item) => item.title || item.message).filter(Boolean).join(", ").slice(0, 1000);
        await WhatsAppMessage.updateOne(
          { waMessageId: receipt.id, status: { $in: eligible[receipt.status] } },
          {
            $set: { status: receipt.status, statusAt: eventDate(receipt.timestamp), ...(error ? { error } : {}) },
            ...(!error ? { $unset: { error: "" } } : {}),
          },
        );
      }
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("WhatsApp webhook processing failed", error instanceof Error ? error.message : "Unknown error");
    // Meta retries non-2xx responses; acknowledging failed writes would lose messages.
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
