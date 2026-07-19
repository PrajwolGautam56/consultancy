import { Schema, model, models } from "mongoose";

const passwordResetSchema=new Schema({
  userId:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true},
  tokenHash:{type:String,required:true,unique:true,index:true},
  expiresAt:{type:Date,required:true,expires:0},
  usedAt:Date,
},{timestamps:true});

export const PasswordReset=models.PasswordReset||model("PasswordReset",passwordResetSchema);
