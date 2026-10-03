import { NextRequest, NextResponse } from "next/server";
import { isPrivileged, requireSession } from "@/lib/api-security";
import { getSmsBalances, getSmsLastTransaction, smsProviderDefaults, type SmsProviderId } from "@/lib/sms";

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Only administrators and managers can manage SMS" }, { status: 403 });
  const providerIds: SmsProviderId[] = ["samaya", "smspasal"];
  const providers = await Promise.all(providerIds.map(async (providerId) => {
    const provider = smsProviderDefaults(providerId);
    if (!provider.configured) return { ...provider, balances: [], lastTransaction: null, error: `Add ${providerId === "samaya" ? "SAMAYA_SMS_API_KEY" : "SMSPASAL_SMS_API_KEY"} in the server environment` };
    const [balanceResult, transactionResult] = await Promise.allSettled([getSmsBalances(providerId), getSmsLastTransaction(providerId)]);
    return {
      ...provider,
      balances: balanceResult.status === "fulfilled" ? balanceResult.value : [],
      lastTransaction: transactionResult.status === "fulfilled" ? transactionResult.value : null,
      error: balanceResult.status === "rejected" ? (balanceResult.reason instanceof Error ? balanceResult.reason.message : "Balance could not be loaded") : "",
    };
  }));
  return NextResponse.json({ providers });
}
