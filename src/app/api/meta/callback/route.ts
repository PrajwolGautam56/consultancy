import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSession } from "@/lib/api-security";
import { encryptMetaToken, metaGraph, metaGraphVersion, metaRedirectUri } from "@/lib/meta";
import { MetaChannelAccount } from "@/models/MetaChannelAccount";

type TokenResponse = { access_token: string };
type InstagramAsset = { id: string; username?: string; name?: string; profile_picture_url?: string };
type Page = { id: string; name: string; access_token: string; instagram_business_account?: InstagramAsset; connected_instagram_account?: InstagramAsset };

function finish(request: NextRequest, status: "connected" | "cancelled" | "failed", count = 0) {
  const url = new URL("/", request.url); url.searchParams.set("channel", "meta"); url.searchParams.set("meta", status);
  if (count) url.searchParams.set("pages", String(count));
  const response = NextResponse.redirect(url); response.cookies.delete("meta_oauth_state"); return response;
}

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return finish(request, "failed");
  if (!isPrivileged(session.role)) return finish(request, "failed");
  const query = request.nextUrl.searchParams;
  if (query.get("error") || !query.get("code")) return finish(request, "cancelled");
  if (!query.get("state") || query.get("state") !== request.cookies.get("meta_oauth_state")?.value) return finish(request, "failed");
  const appId = process.env.META_APP_ID || ""; const appSecret = process.env.META_APP_SECRET || "";
  try {
    const origin = new URL(request.url).origin;
    const tokenUrl = new URL(`https://graph.facebook.com/${metaGraphVersion()}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: metaRedirectUri(origin), code: query.get("code") || "" }).toString();
    const tokenResponse = await fetch(tokenUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const shortToken = await tokenResponse.json() as TokenResponse & { error?: { message?: string } };
    if (!tokenResponse.ok || !shortToken.access_token) throw new Error(shortToken.error?.message || "Meta login token exchange failed");
    let userToken = shortToken.access_token;
    try {
      const longUrl = new URL(`https://graph.facebook.com/${metaGraphVersion()}/oauth/access_token`);
      longUrl.search = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: userToken }).toString();
      const longResponse = await fetch(longUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const longToken = await longResponse.json() as TokenResponse;
      if (longResponse.ok && longToken.access_token) userToken = longToken.access_token;
    } catch { /* Page tokens can still be retrieved from the original token. */ }
    const pages = await metaGraph<{ data: Page[] }>("me/accounts?fields=id,name,access_token,tasks,instagram_business_account{id,username,name,profile_picture_url},connected_instagram_account{id,username,name,profile_picture_url}&limit=100", userToken);
    await connectMongo(); let connected = 0;
    for (const page of pages.data || []) {
      if (!page.id || !page.access_token) continue;
      const instagram = page.instagram_business_account || page.connected_instagram_account;
      let subscribed = false; let subscriptionError = "";
      try {
        await metaGraph(`${page.id}/subscribed_apps`, page.access_token, { method: "POST", body: JSON.stringify({ subscribed_fields: "messages,messaging_postbacks,message_deliveries,message_reads" }) });
        subscribed = true;
      } catch (error) { subscriptionError = error instanceof Error ? error.message.slice(0, 500) : "Webhook subscription failed"; }
      await MetaChannelAccount.findOneAndUpdate({ pageId: page.id }, { $set: {
        pageName: page.name || `Page ${page.id}`, encryptedPageAccessToken: encryptMetaToken(page.access_token),
        instagramAccountId: instagram?.id || undefined, instagramUsername: instagram?.username || "",
        instagramName: instagram?.name || "", instagramAvatar: instagram?.profile_picture_url || "",
        connectedBy: session.userId, connectedByName: session.name, active: true, subscribed,
        subscriptionError, tokenLastValidatedAt: new Date(),
      } }, { upsert: true, new: true, setDefaultsOnInsert: true });
      connected += 1;
    }
    return finish(request, "connected", connected);
  } catch (error) {
    console.error("Meta connection failed", error instanceof Error ? error.message : "Unknown error");
    return finish(request, "failed");
  }
}
