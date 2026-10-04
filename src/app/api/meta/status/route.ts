import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import { requireSession } from "@/lib/api-security";
import { metaConnectionConfigured } from "@/lib/meta";
import { MetaChannelAccount } from "@/models/MetaChannelAccount";

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  await connectMongo();
  const accounts = await MetaChannelAccount.find({ active: true }).select("pageId pageName instagramAccountId instagramUsername instagramName instagramAvatar subscribed subscriptionError updatedAt").sort({ pageName: 1 }).lean();
  return NextResponse.json({ configured: metaConnectionConfigured(), accounts });
}
