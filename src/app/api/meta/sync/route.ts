import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { decryptMetaToken, metaGraph, type MetaPlatform } from "@/lib/meta";
import { saveMetaMessage } from "@/lib/meta-messages";
import { MetaChannelAccount } from "@/models/MetaChannelAccount";

type GraphPerson = { id?: string; name?: string; username?: string };
type GraphMessage = { id?: string; message?: string; from?: GraphPerson; to?: { data?: GraphPerson[] }; created_time?: string; attachments?: { data?: Array<{ mime_type?: string; image_data?: { url?: string }; file_url?: string }> } };
type GraphConversation = { id?: string; participants?: { data?: GraphPerson[] }; messages?: { data?: GraphMessage[] } };

async function syncPlatform(account: { _id: unknown; pageId: string; pageName: string; instagramAccountId?: string; encryptedPageAccessToken: string }, platform: MetaPlatform) {
  const token = decryptMetaToken(account.encryptedPageAccessToken);
  const accountIdentity = platform === "instagram" ? account.instagramAccountId : account.pageId;
  if (!accountIdentity) return 0;
  const path = `${account.pageId}/conversations?platform=${platform === "instagram" ? "instagram" : "messenger"}&fields=id,participants,messages.limit(50){id,message,from,to,created_time,attachments}&limit=40`;
  const result = await metaGraph<{ data?: GraphConversation[] }>(path, token); let saved = 0;
  for (const conversation of result.data || []) {
    const participant = (conversation.participants?.data || []).find((person) => person.id && person.id !== accountIdentity && person.id !== account.pageId);
    const messages = [...(conversation.messages?.data || [])].reverse();
    for (const message of messages) {
      const senderId = message.from?.id || ""; const recipients = message.to?.data || [];
      const inbound = senderId !== accountIdentity && senderId !== account.pageId;
      const participantId = participant?.id || (inbound ? senderId : recipients.find((person) => person.id !== accountIdentity && person.id !== account.pageId)?.id) || "";
      if (!participantId || !senderId) continue;
      const recipientId = recipients[0]?.id || (inbound ? accountIdentity : participantId) || "";
      await saveMetaMessage({
        account, platform, participantId, participantName: participant?.name || participant?.username,
        externalConversationId: conversation.id, externalMessageId: message.id,
        direction: inbound ? "inbound" : "outbound", senderId, recipientId,
        text: message.message || "", attachments: (message.attachments?.data || []).map((attachment) => ({ type: attachment.mime_type || "file", url: attachment.image_data?.url || attachment.file_url })),
        occurredAt: new Date(message.created_time || Date.now()), status: inbound ? "received" : "sent",
      });
      saved += 1;
    }
  }
  return saved;
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Administrator or manager access is required" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  await connectMongo();
  const accounts = await MetaChannelAccount.find({ active: true }).select("+encryptedPageAccessToken pageId pageName instagramAccountId");
  let imported = 0; const errors: string[] = [];
  for (const account of accounts) {
    try { imported += await syncPlatform(account, "facebook"); } catch (error) { errors.push(`${account.pageName} Facebook: ${error instanceof Error ? error.message : "sync failed"}`); }
    if (account.instagramAccountId) {
      try { imported += await syncPlatform(account, "instagram"); } catch (error) { errors.push(`${account.pageName} Instagram: ${error instanceof Error ? error.message : "sync failed"}`); }
    }
  }
  return NextResponse.json({ imported, errors: errors.slice(0, 10) });
}
