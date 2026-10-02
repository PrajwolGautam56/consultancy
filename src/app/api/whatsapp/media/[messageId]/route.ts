import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import { rateLimit, requireSession } from "@/lib/api-security";
import { whatsappPhonePatterns } from "@/lib/whatsapp";
import { Lead } from "@/models/Lead";
import { WhatsAppMessage } from "@/models/WhatsAppMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MEDIA_TYPES = new Set(["image", "sticker", "audio", "video", "document"]);
const INLINE_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm",
  "video/mp4", "video/3gpp", "video/webm",
]);

type StoredMessage = {
  leadId?: unknown;
  waId: string;
  direction: string;
  type: string;
  mediaId?: string;
  mimeType?: string;
};
type LeadAccess = {
  assignedTo?: unknown;
  followUpAssignedTo?: unknown;
  counsellor?: string;
  followUpAssignee?: string;
};
type MetaMedia = {
  id?: string;
  url?: string;
  mime_type?: string;
  file_size?: number;
};

function canAccessLead(lead: LeadAccess, session: { role: string; userId: string; name: string }) {
  if (!["manager", "counsellor"].includes(session.role)) return true;
  return String(lead.assignedTo || "") === session.userId ||
    String(lead.followUpAssignedTo || "") === session.userId ||
    lead.counsellor === session.name || lead.followUpAssignee === session.name;
}

function safeMetaMediaUrl(value: string) {
  try {
    const url = new URL(value);
    // Media URLs are returned by Meta. Never let this endpoint fetch an arbitrary host.
    return url.protocol === "https:" && url.hostname === "lookaside.fbsbx.com" &&
      url.port === "" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function noStoreHeaders(contentType?: string) {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Vary": "Cookie",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

function mediaError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders() });
}

function limitedStream(source: ReadableStream<Uint8Array>, abort: AbortController, clearTimer: () => void) {
  const reader = source.getReader();
  let transferred = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { clearTimer(); controller.close(); return; }
        transferred += value.byteLength;
        if (transferred > MAX_MEDIA_BYTES) {
          clearTimer();
          abort.abort();
          controller.error(new Error("WhatsApp media exceeds the allowed size"));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        clearTimer();
        controller.error(error);
      }
    },
    cancel() {
      clearTimer();
      abort.abort();
      return reader.cancel();
    },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const limited = rateLimit(request, `whatsapp-media:${session.userId}`, 120, 60_000);
  if (limited) return limited;

  const { messageId } = await params;
  if (!/^[a-f\d]{24}$/i.test(messageId)) return mediaError("Invalid message", 400);

  try {
    await connectMongo();
    const message = await WhatsAppMessage.findById(messageId)
      .select("leadId waId direction type mediaId mimeType").lean() as StoredMessage | null;
    if (!message || !["inbound", "outbound"].includes(message.direction) || !MEDIA_TYPES.has(message.type) ||
      !message.mediaId || !/^\d{1,30}$/.test(message.mediaId)) {
      return mediaError("Media not found", 404);
    }

    // A message already linked to a lead must remain governed by that lead's owner,
    // even if its phone number is later reused by a different student.
    const phonePatterns = whatsappPhonePatterns(message.waId);
    const lead = message.leadId
      ? await Lead.findOne({ _id: message.leadId, archivedAt: null })
        .select("assignedTo followUpAssignedTo counsellor followUpAssignee").lean() as LeadAccess | null
      : phonePatterns.length
        ? await Lead.findOne({ phone: { $in: phonePatterns }, archivedAt: null })
          .select("assignedTo followUpAssignedTo counsellor followUpAssignee").lean() as LeadAccess | null
        : null;
    if (lead) {
      if (!canAccessLead(lead, session)) return mediaError("Not authorized", 403);
    } else if (!["super_admin", "admin", "receptionist"].includes(session.role)) {
      return mediaError("Not authorized", 403);
    }

    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) return mediaError("WhatsApp media is not configured", 503);
    const version = process.env.META_GRAPH_API_VERSION || "v26.0";
    if (!/^v\d+\.\d+$/.test(version)) return mediaError("WhatsApp media is not configured", 503);

    const metaResponse = await fetch(`https://graph.facebook.com/${version}/${message.mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
    if (!metaResponse.ok) return mediaError("Media is no longer available from WhatsApp", 502);
    const meta = await metaResponse.json() as MetaMedia;
    if (meta.id !== message.mediaId || !meta.url || !safeMetaMediaUrl(meta.url)) {
      return mediaError("Invalid WhatsApp media response", 502);
    }
    if (typeof meta.file_size === "number" &&
      (!Number.isFinite(meta.file_size) || meta.file_size < 0 || meta.file_size > MAX_MEDIA_BYTES)) {
      return mediaError("Media is too large to preview", 413);
    }

    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 30_000);
    let fileResponse: Response;
    try {
      fileResponse = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store", redirect: "manual", signal: abort.signal,
      });
    } catch {
      clearTimeout(timeout);
      return mediaError("Could not load WhatsApp media", 502);
    }
    if (!fileResponse.ok || !fileResponse.body) {
      clearTimeout(timeout);
      await fileResponse.body?.cancel();
      return mediaError("Could not load WhatsApp media", 502);
    }
    const contentLength = Number(fileResponse.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_MEDIA_BYTES) {
      clearTimeout(timeout);
      await fileResponse.body.cancel();
      return mediaError("Media is too large to preview", 413);
    }

    const mimeType = (meta.mime_type || message.mimeType || "").split(";")[0].trim().toLowerCase();
    const canPreview = message.type !== "document" && INLINE_MIME_TYPES.has(mimeType) &&
      (message.type === "sticker" ? mimeType.startsWith("image/") : mimeType.startsWith(`${message.type}/`));
    const contentType = canPreview ? mimeType : "application/octet-stream";
    const extension = mimeType === "application/pdf" ? "pdf" : "bin";
    const disposition = canPreview ? "inline" : `attachment; filename="whatsapp-document.${extension}"`;
    const stream = limitedStream(fileResponse.body, abort, () => clearTimeout(timeout));
    return new NextResponse(stream, {
      headers: { ...noStoreHeaders(contentType), "Content-Disposition": disposition },
    });
  } catch {
    return mediaError("Could not load WhatsApp media", 502);
  }
}
