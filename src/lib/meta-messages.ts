import { connectMongo } from "@/lib/mongodb";
import { decryptMetaToken, metaGraph, type MetaPlatform } from "@/lib/meta";
import { MetaConversation } from "@/models/MetaConversation";
import { MetaMessage } from "@/models/MetaMessage";

type AccountShape = {
  _id: unknown; pageId: string; pageName: string; instagramAccountId?: string;
  encryptedPageAccessToken: string;
};

export async function resolveParticipant(account: AccountShape, platform: MetaPlatform, participantId: string) {
  try {
    const token = decryptMetaToken(account.encryptedPageAccessToken);
    const fields = platform === "instagram" ? "name,username,profile_pic" : "first_name,last_name,profile_pic";
    const profile = await metaGraph<Record<string, string>>(`${participantId}?fields=${fields}`, token);
    return {
      name: profile.name || profile.username || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || participantId,
      avatar: profile.profile_pic || "",
    };
  } catch { return { name: participantId, avatar: "" }; }
}

export async function saveMetaMessage(input: {
  account: AccountShape; platform: MetaPlatform; participantId: string; participantName?: string; participantAvatar?: string;
  externalConversationId?: string; externalMessageId?: string; direction: "inbound" | "outbound";
  senderId: string; recipientId: string; text?: string; attachments?: Array<{ type?: string; url?: string }>;
  occurredAt: Date; status?: "received" | "sent" | "delivered" | "read" | "failed";
}) {
  await connectMongo();
  if (input.externalMessageId) {
    const existing = await MetaMessage.findOne({ externalMessageId: input.externalMessageId });
    if (existing) return existing;
  }
  const fallback = input.participantName ? { name: input.participantName, avatar: input.participantAvatar || "" } : await resolveParticipant(input.account, input.platform, input.participantId);
  const conversation = await MetaConversation.findOneAndUpdate({
    accountId: input.account._id, platform: input.platform, participantId: input.participantId,
  }, {
    $set: {
      participantName: fallback.name, ...(fallback.avatar ? { participantAvatar: fallback.avatar } : {}),
      ...(input.externalConversationId ? { externalConversationId: input.externalConversationId } : {}),
      lastMessage: input.text || (input.attachments?.length ? `[${input.attachments[0].type || "attachment"}]` : "Message"),
      lastMessageAt: input.occurredAt,
      ...(input.direction === "inbound" ? { lastInboundAt: input.occurredAt } : {}),
    },
    ...(input.direction === "inbound" ? { $inc: { unreadCount: 1 } } : {}),
  }, { upsert: true, new: true, setDefaultsOnInsert: true });
  try {
    return await MetaMessage.create({
      conversationId: conversation._id, accountId: input.account._id, platform: input.platform,
      externalMessageId: input.externalMessageId || undefined, direction: input.direction,
      senderId: input.senderId, recipientId: input.recipientId, text: input.text || "",
      attachments: (input.attachments || []).filter((item) => item.url).map((item) => ({ type: item.type || "file", url: item.url })),
      status: input.status || (input.direction === "inbound" ? "received" : "sent"), occurredAt: input.occurredAt,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000 && input.externalMessageId) return MetaMessage.findOne({ externalMessageId: input.externalMessageId });
    throw error;
  }
}
