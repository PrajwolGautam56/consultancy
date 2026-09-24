import { Schema, model, models } from "mongoose";

const whatsAppMessageSchema = new Schema({
  waMessageId: { type: String, unique: true, sparse: true, index: true },
  leadId: { type: Schema.Types.ObjectId, ref: "Lead", index: true },
  waId: { type: String, required: true, index: true },
  direction: { type: String, enum: ["inbound", "outbound"], required: true, index: true },
  type: { type: String, default: "text", maxlength: 40 },
  body: { type: String, default: "", maxlength: 5000 },
  status: { type: String, enum: ["received", "queued", "sent", "delivered", "read", "failed"], required: true, index: true },
  error: { type: String, maxlength: 1000 },
  sentBy: { type: Schema.Types.ObjectId, ref: "User" },
  sentByName: { type: String, maxlength: 120 },
  occurredAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

whatsAppMessageSchema.index({ leadId: 1, occurredAt: -1 });
export const WhatsAppMessage = models.WhatsAppMessage || model("WhatsAppMessage", whatsAppMessageSchema);
