import { Schema, model, models } from "mongoose";

const metaConversationSchema = new Schema({
  accountId: { type: Schema.Types.ObjectId, ref: "MetaChannelAccount", required: true, index: true },
  platform: { type: String, enum: ["facebook", "instagram"], required: true, index: true },
  participantId: { type: String, required: true, index: true },
  participantName: { type: String, required: true, maxlength: 180 },
  participantAvatar: { type: String, maxlength: 1200 },
  externalConversationId: { type: String, maxlength: 240 },
  lastMessage: { type: String, maxlength: 1000 },
  lastMessageAt: { type: Date, index: true },
  lastInboundAt: Date,
  unreadCount: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

metaConversationSchema.index({ accountId: 1, platform: 1, participantId: 1 }, { unique: true });
metaConversationSchema.index({ lastMessageAt: -1 });

export const MetaConversation = models.MetaConversation || model("MetaConversation", metaConversationSchema);
