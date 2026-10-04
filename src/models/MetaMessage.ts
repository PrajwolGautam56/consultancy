import { Schema, model, models } from "mongoose";

const metaMessageSchema = new Schema({
  conversationId: { type: Schema.Types.ObjectId, ref: "MetaConversation", required: true, index: true },
  accountId: { type: Schema.Types.ObjectId, ref: "MetaChannelAccount", required: true, index: true },
  platform: { type: String, enum: ["facebook", "instagram"], required: true, index: true },
  externalMessageId: { type: String, index: true, unique: true, sparse: true },
  direction: { type: String, enum: ["inbound", "outbound"], required: true },
  senderId: { type: String, required: true },
  recipientId: { type: String, required: true },
  text: { type: String, maxlength: 4000, default: "" },
  attachments: [{ type: { type: String, maxlength: 40 }, url: { type: String, maxlength: 1600 } }],
  status: { type: String, enum: ["received", "sent", "delivered", "read", "failed"], default: "received" },
  error: { type: String, maxlength: 500 },
  occurredAt: { type: Date, required: true, index: true },
}, { timestamps: true });

export const MetaMessage = models.MetaMessage || model("MetaMessage", metaMessageSchema);
