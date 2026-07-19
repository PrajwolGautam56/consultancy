import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { rateLimit, requireSameOrigin } from "@/lib/api-security";
import { PasswordReset } from "@/models/PasswordReset";
import { User } from "@/models/User";

const resetSchema=z.object({token:z.string().length(64),password:z.string().min(10).max(128)});

export async function POST(request:NextRequest) {
  if(!requireSameOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const limited=rateLimit(request,"reset-password",8,15*60_000);if(limited)return limited;
  const parsed=resetSchema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"Invalid reset link or password"},{status:400});
  try {
    await connectMongo(); const tokenHash=createHash("sha256").update(parsed.data.token).digest("hex");
    const reset=await PasswordReset.findOne({tokenHash,usedAt:null,expiresAt:{$gt:new Date()}});
    if(!reset)return NextResponse.json({error:"This reset link is invalid or has expired"},{status:400});
    const user=await User.findById(reset.userId);if(!user||!user.active)return NextResponse.json({error:"This account is unavailable"},{status:400});
    user.passwordHash=await bcrypt.hash(parsed.data.password,12);await user.save();
    reset.usedAt=new Date();await reset.save();await PasswordReset.deleteMany({userId:user._id,_id:{$ne:reset._id}});
    return NextResponse.json({message:"Password changed successfully. You can now sign in."});
  } catch {return NextResponse.json({error:"Password could not be reset"},{status:500});}
}
