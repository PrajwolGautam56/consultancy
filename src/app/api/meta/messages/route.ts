import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { decryptMetaToken, metaGraph } from "@/lib/meta";
import { saveMetaMessage } from "@/lib/meta-messages";
import { MetaChannelAccount } from "@/models/MetaChannelAccount";
import { MetaConversation } from "@/models/MetaConversation";
import { MetaMessage } from "@/models/MetaMessage";

const sendSchema = z.object({ conversationId: z.string().regex(/^[a-f\d]{24}$/i), text: z.string().trim().min(1).max(1000) }).strict();

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  await connectMongo();
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (conversationId && /^[a-f\d]{24}$/i.test(conversationId)) {
    const conversation = await MetaConversation.findById(conversationId).lean();
    if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    await MetaConversation.updateOne({ _id: conversationId }, { $set: { unreadCount: 0 } });
    const messages = await MetaMessage.find({ conversationId }).sort({ occurredAt: 1 }).limit(200).lean();
    return NextResponse.json({ conversation: { ...conversation, unreadCount: 0 }, messages });
  }
  const conversations = await MetaConversation.find().populate("accountId", "pageId pageName instagramAccountId instagramUsername").sort({ lastMessageAt: -1 }).limit(300).lean();
  return NextResponse.json({ conversations });
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role) && session.role !== "counsellor") return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = sendSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Choose a conversation and write a reply" }, { status: 400 });
  await connectMongo();
  const conversation = await MetaConversation.findById(parsed.data.conversationId);
  if (!conversation) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  if (!conversation.lastInboundAt || Date.now() - new Date(conversation.lastInboundAt).getTime() > 24 * 60 * 60 * 1000) return NextResponse.json({ error: "The 24-hour reply window is closed" }, { status: 409 });
  const account = await MetaChannelAccount.findById(conversation.accountId).select("+encryptedPageAccessToken pageId pageName instagramAccountId active");
  if (!account?.active) return NextResponse.json({ error: "This Page is disconnected" }, { status: 409 });
  const token = decryptMetaToken(account.encryptedPageAccessToken);
  const payload: Record<string, unknown> = { recipient: { id: conversation.participantId }, message: { text: parsed.data.text } };
  if (conversation.platform === "facebook") payload.messaging_type = "RESPONSE";
  try {
    const sent = await metaGraph<{ message_id?: string }>(`${account.pageId}/messages`, token, { method: "POST", body: JSON.stringify(payload) });
    const message = await saveMetaMessage({
      account, platform: conversation.platform, participantId: conversation.participantId,
      participantName: conversation.participantName, participantAvatar: conversation.participantAvatar,
      externalMessageId: sent.message_id, direction: "outbound", senderId: account.pageId,
      recipientId: conversation.participantId, text: parsed.data.text, occurredAt: new Date(), status: "sent",
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Meta reply failed" }, { status: 502 }); }
}
