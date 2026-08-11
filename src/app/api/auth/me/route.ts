import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-security";

export async function GET(request:NextRequest) {
  const session=await requireSession(request); if(session instanceof NextResponse)return session;
  return NextResponse.json({user:{userId:session.userId,email:session.email,name:session.name,role:session.role}});
}
