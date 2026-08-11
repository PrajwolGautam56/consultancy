import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { requireSameOrigin, requireSession } from "@/lib/api-security";
import { User } from "@/models/User";

export async function POST(request:NextRequest) {
  const session=await requireSession(request); if(session instanceof NextResponse)return session;
  if(!requireSameOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
  await User.updateOne({_id:session.userId,currentSessionId:session.sessionId},{$unset:{currentSessionId:1}});
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, expires: new Date(0), path: "/" });
  return response;
}
