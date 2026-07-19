import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { rateLimit, requireSameOrigin } from "@/lib/api-security";
import { User } from "@/models/User";
import { PasswordReset } from "@/models/PasswordReset";
import { sendPasswordReset } from "@/lib/email";

const requestSchema=z.object({email:z.string().trim().email().max(254)});
const generic={message:"If an active account exists, a password reset link has been sent."};

export async function POST(request:NextRequest) {
  if(!requireSameOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const limited=rateLimit(request,"forgot-password",5,15*60_000);if(limited)return limited;
  const parsed=requestSchema.safeParse(await request.json());if(!parsed.success)return NextResponse.json(generic);
  try {
    await connectMongo(); const user=await User.findOne({email:parsed.data.email.toLowerCase(),active:true});
    if(!user)return NextResponse.json(generic);
    await PasswordReset.deleteMany({userId:user._id});
    const token=randomBytes(32).toString("hex"); const tokenHash=createHash("sha256").update(token).digest("hex");
    await PasswordReset.create({userId:user._id,tokenHash,expiresAt:new Date(Date.now()+30*60_000)});
    const appUrl=process.env.APP_URL||request.nextUrl.origin;
    await sendPasswordReset({name:user.name,email:user.email,resetUrl:`${appUrl}/reset-password?token=${token}`});
    return NextResponse.json(generic);
  } catch(error) {console.warn("Password reset request could not be completed",error instanceof Error?error.name:"UnknownError");return NextResponse.json(generic);}
}
