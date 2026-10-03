import { Schema, model, models } from "mongoose";

const smsRecipientSchema = new Schema({
  leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true },
  name: { type: String, required: true, maxlength: 120 },
  phone: { type: String, required: true, maxlength: 24 },
  renderedMessage: { type: String, required: true, maxlength: 720 },
  encoding: { type: String, enum: ["text", "unicode"], required: true },
  segments: { type: Number, min: 1, max: 12, required: true },
  status: { type: String, enum: ["pending", "sending", "submitted", "delivered", "failed"], default: "pending" },
  shootId: { type: String, maxlength: 180 },
  deliveryDescription: { type: String, maxlength: 500 },
  error: { type: String, maxlength: 500 },
}, { _id: true });

const smsCampaignSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  providerId: { type: String, enum: ["samaya", "smspasal"], required: true, index: true },
  senderId: { type: String, required: true, trim: true, maxlength: 30 },
  routeId: { type: String, trim: true, maxlength: 40 },
  providerCampaignId: { type: String, trim: true, maxlength: 40 },
  messageTemplate: { type: String, required: true, maxlength: 720 },
  status: { type: String, enum: ["ready", "processing", "completed", "needs_attention", "cancelled"], default: "ready", index: true },
  recipients: [smsRecipientSchema],
  total: { type: Number, default: 0 },
  submitted: { type: Number, default: 0 },
  delivered: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  estimatedCredits: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  createdByName: { type: String, required: true, maxlength: 120 },
  scheduledAt: Date,
  completedAt: Date,
  processingLockUntil: Date,
}, { timestamps: true });

smsCampaignSchema.index({ createdAt: -1 });
smsCampaignSchema.index({ status: 1, scheduledAt: 1 });

export const SmsCampaign = models.SmsCampaign || model("SmsCampaign", smsCampaignSchema);
