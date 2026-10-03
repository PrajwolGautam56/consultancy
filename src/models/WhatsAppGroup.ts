import { Schema, model, models } from "mongoose";

const whatsAppGroupSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, trim: true, maxlength: 180, default: "" },
  color: { type: String, enum: ["green", "blue", "violet", "orange", "rose"], default: "green" },
  memberIds: [{ type: Schema.Types.ObjectId, ref: "Lead" }],
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

whatsAppGroupSchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
whatsAppGroupSchema.index({ memberIds: 1 });

export const WhatsAppGroup = models.WhatsAppGroup || model("WhatsAppGroup", whatsAppGroupSchema);
