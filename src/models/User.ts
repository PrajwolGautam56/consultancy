import { Schema, model, models } from "mongoose";

const userSchema = new Schema({
  name: { type: String, required: true, trim: true }, email: { type: String, required: true, unique: true, lowercase: true },
  phone: String, passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["super_admin", "admin", "manager", "counsellor", "receptionist"], default: "counsellor" },
  branchId: { type: Schema.Types.ObjectId, ref: "Branch" }, active: { type: Boolean, default: true }, lastLoginAt: Date,
}, { timestamps: true });
export const User = models.User || model("User", userSchema);
