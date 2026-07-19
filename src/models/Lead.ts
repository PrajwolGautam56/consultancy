import { Schema, model, models } from "mongoose";

const activitySchema = new Schema({
  type: { type: String, enum: ["note", "call", "visit", "stage", "follow_up", "assignment"], required: true },
  text: { type: String, required: true, trim: true, maxlength: 2000 },
  authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  authorName: { type: String, required: true },
  occurredAt: { type: Date, default: Date.now },
}, { _id: true });

const leadSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, required: true, unique: true, index: true, trim: true },
  email: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
  address: { type: String, trim: true, maxlength: 300 },
  education: { type: String, trim: true, maxlength: 300 },
  country: { type: String, trim: true, maxlength: 100 },
  course: { type: String, trim: true, maxlength: 200 },
  university: { type: String, trim: true, maxlength: 200 },
  source: { type: String, enum: ["Facebook", "Instagram", "Phone call", "Walk-in", "Referral", "Website", "Other"], default: "Other" },
  stage: { type: String, enum: ["New inquiry", "Contacted", "Counselling", "Application", "Enrolled", "Lost"], default: "New inquiry", index: true },
  priority: { type: String, enum: ["Low", "Medium", "High"], default: "Medium" },
  counsellor: { type: String, default: "Unassigned", maxlength: 120 },
  assignedTo: { type: Schema.Types.ObjectId, ref: "User", index: true },
  branchId: { type: Schema.Types.ObjectId, ref: "Branch", index: true },
  inOffice: { type: Boolean, default: false, index: true },
  checkedInAt: Date,
  nextFollowUp: Date,
  activities: [activitySchema],
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  archivedAt: Date,
}, { timestamps: true, optimisticConcurrency: true });

leadSchema.index({ name: "text", phone: "text", email: "text", country: "text", course: "text" });
export const Lead = models.Lead || model("Lead", leadSchema);
