import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import { verifyMetaSignature, type MetaPlatform } from "@/lib/meta";
import { saveMetaMessage } from "@/lib/meta-messages";
import { MetaChannelAccount } from "@/models/MetaChannelAccount";
import { MetaMessage } from "@/models/MetaMessage";

type WebhookMessage = {
  sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: Array<{ type?: string; payload?: { url?: string } }> };
  delivery?: { mids?: string[] }; read?: { watermark?: number };
};
type WebhookBody = { object?: string; entry?: Array<{ id?: string; messaging?: WebhookMessage[] }> };

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  if (query.get("hub.mode") === "subscribe" && query.get("hub.verify_token") === process.env.META_PAGE_VERIFY_TOKEN) return new NextResponse(query.get("hub.challenge") || "", { status: 200 });
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  let body: WebhookBody; try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  await connectMongo();
  for (const entry of body.entry || []) {
    const platform: MetaPlatform = body.object === "instagram" ? "instagram" : "facebook";
    const account = platform === "instagram"
      ? await MetaChannelAccount.findOne({ instagramAccountId: entry.id, active: true }).select("+encryptedPageAccessToken pageId pageName instagramAccountId")
      : await MetaChannelAccount.findOne({ pageId: entry.id, active: true }).select("+encryptedPageAccessToken pageId pageName instagramAccountId");
    if (!account) continue;
    for (const event of entry.messaging || []) {
      if (event.delivery?.mids?.length) { await MetaMessage.updateMany({ externalMessageId: { $in: event.delivery.mids } }, { $set: { status: "delivered" } }); continue; }
      if (event.read?.watermark) { await MetaMessage.updateMany({ accountId: account._id, direction: "outbound", occurredAt: { $lte: new Date(event.read.watermark) } }, { $set: { status: "read" } }); continue; }
      if (!event.message || event.message.is_echo) continue;
      const senderId = event.sender?.id || ""; const recipientId = event.recipient?.id || "";
      if (!senderId || !recipientId) continue;
      await saveMetaMessage({
        account, platform, participantId: senderId, externalMessageId: event.message.mid,
        direction: "inbound", senderId, recipientId, text: event.message.text || "",
        attachments: (event.message.attachments || []).map((item) => ({ type: item.type, url: item.payload?.url })),
        occurredAt: new Date(event.timestamp || Date.now()),
      });
    }
  }
  return NextResponse.json({ received: true });
}
