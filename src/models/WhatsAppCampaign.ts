import { Schema, model, models } from "mongoose";

const recipientSchema = new Schema({
  leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true },
  name: { type: String, required: true, maxlength: 120 },
  phone: { type: String, required: true, maxlength: 24 },
  status: { type: String, enum: ["pending", "sent", "failed"], default: "pending" },
  messageId: String,
  error: { type: String, maxlength: 500 },
}, { _id: false });

const whatsAppCampaignSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  templateName: { type: String, required: true, trim: true, maxlength: 512 },
  language: { type: String, required: true, default: "en", maxlength: 20 },
  bodyParameters: [{ type: String, maxlength: 500 }],
  status: { type: String, enum: ["ready", "processing", "completed", "failed"], default: "ready", index: true },
  recipients: [recipientSchema],
  total: { type: Number, default: 0 },
  sent: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  createdByName: { type: String, required: true, maxlength: 120 },
  completedAt: Date,
}, { timestamps: true });

export const WhatsAppCampaign = models.WhatsAppCampaign || model("WhatsAppCampaign", whatsAppCampaignSchema);
