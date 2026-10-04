import { Schema, model, models } from "mongoose";

const metaChannelAccountSchema = new Schema({
  pageId: { type: String, required: true, unique: true, index: true },
  pageName: { type: String, required: true, maxlength: 180 },
  encryptedPageAccessToken: { type: String, required: true, select: false },
  instagramAccountId: { type: String, index: true, sparse: true },
  instagramUsername: { type: String, maxlength: 180 },
  instagramName: { type: String, maxlength: 180 },
  instagramAvatar: { type: String, maxlength: 1200 },
  connectedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  connectedByName: { type: String, required: true, maxlength: 120 },
  active: { type: Boolean, default: true, index: true },
  subscribed: { type: Boolean, default: false },
  subscriptionError: { type: String, maxlength: 500 },
  tokenLastValidatedAt: Date,
}, { timestamps: true });

export const MetaChannelAccount = models.MetaChannelAccount || model("MetaChannelAccount", metaChannelAccountSchema);
