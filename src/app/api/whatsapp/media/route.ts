import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import { rateLimit, requireSameOrigin, requireSession } from "@/lib/api-security";
import { normalizeWhatsAppPhone, sendWhatsApp, whatsappPhonePatterns } from "@/lib/whatsapp";
import { Lead } from "@/models/Lead";
import { WhatsAppMessage } from "@/models/WhatsAppMessage";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
const MAX_CAPTION_LENGTH = 1024;

type LeadSummary = {
  _id: unknown; phone: string;
  assignedTo?: unknown; followUpAssignedTo?: unknown;
  counsellor?: string; followUpAssignee?: string;
};

function canAccessLead(lead: LeadSummary, session: { role: string; userId: string; name: string }) {
  if (!["manager", "counsellor"].includes(session.role)) return true;
  return String(lead.assignedTo || "") === session.userId ||
    String(lead.followUpAssignedTo || "") === session.userId ||
    lead.counsellor === session.name || lead.followUpAssignee === session.name;
}

function isSupportedImage(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  return false;
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function boundedFormData(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_upload");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("too_large");
    }
    chunks.push(value);
  }
  const contentType = request.headers.get("content-type") || "";
  return new Response(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size), {
    headers: { "Content-Type": contentType },
  }).formData();
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  if (!requireSameOrigin(request)) return errorResponse("Invalid request origin", 403);
  const limited = rateLimit(request, `whatsapp-image-send:${session.userId}`, 15, 60_000);
  if (limited) return limited;

  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) return errorResponse("Image must be 5 MB or smaller", 413);

  let form: FormData;
  try { form = await boundedFormData(request); }
  catch (error) {
    return errorResponse(
      error instanceof Error && error.message === "too_large" ? "Image must be 5 MB or smaller" : "Invalid image upload",
      error instanceof Error && error.message === "too_large" ? 413 : 400,
    );
  }
  const conversationId = form.get("conversationId");
  const image = form.get("image");
  const captionValue = form.get("caption");
  const caption = typeof captionValue === "string" ? captionValue.trim() : "";
  if (typeof conversationId !== "string" || !(image instanceof File) ||
    (captionValue !== null && typeof captionValue !== "string") || caption.length > MAX_CAPTION_LENGTH ||
    image.size === 0 || image.size > MAX_IMAGE_BYTES || !["image/jpeg", "image/png"].includes(image.type)) {
    return errorResponse("Choose a JPEG or PNG image up to 5 MB", 400);
  }
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!isSupportedImage(bytes, image.type)) return errorResponse("Image format does not match the file", 400);

  await connectMongo();
  let lead: LeadSummary | null = null;
  let waId: string;
  if (conversationId.startsWith("wa:")) {
    waId = conversationId.slice(3);
    if (!/^\d{8,15}$/.test(waId)) return errorResponse("Invalid conversation", 400);
    if (!["super_admin", "admin", "receptionist"].includes(session.role)) return errorResponse("Not authorized", 403);
    if (await Lead.exists({ phone: { $in: whatsappPhonePatterns(waId) }, archivedAt: null })) {
      return errorResponse("This number is linked to a student. Open the student conversation.", 409);
    }
  } else {
    if (!/^[a-f\d]{24}$/i.test(conversationId)) return errorResponse("Invalid conversation", 400);
    lead = await Lead.findOne({ _id: conversationId, archivedAt: null })
      .select("phone assignedTo followUpAssignedTo counsellor followUpAssignee").lean() as LeadSummary | null;
    if (!lead) return errorResponse("Student not found", 404);
    if (!canAccessLead(lead, session)) return errorResponse("This student is not assigned to you", 403);
    waId = normalizeWhatsAppPhone(lead.phone);
    if (!/^\d{8,15}$/.test(waId)) return errorResponse("Student has no valid WhatsApp number", 400);
  }

  const latestInbound = await WhatsAppMessage.findOne({
    waId, direction: "inbound", ...(lead ? { $or: [{ leadId: lead._id }, { leadId: null }] } : { leadId: null }),
  }).sort({ occurredAt: -1 }).select("occurredAt").lean() as { occurredAt: Date } | null;
  if (!latestInbound || Date.now() - new Date(latestInbound.occurredAt).getTime() > 24 * 60 * 60 * 1000) {
    return errorResponse("The 24-hour reply window is closed. Send an approved template instead.", 409);
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.META_GRAPH_API_VERSION || "v26.0";
  if (!token || !phoneId || !/^\d{1,30}$/.test(phoneId) || !/^v\d+\.\d+$/.test(version)) {
    return errorResponse("WhatsApp is not configured", 503);
  }

  let acceptedMessageId: string | null = null;
  try {
    const upload = new FormData();
    upload.set("messaging_product", "whatsapp");
    upload.set("type", image.type);
    upload.set("file", new Blob([bytes], { type: image.type }), image.type === "image/png" ? "image.png" : "image.jpg");
    const uploaded = await fetch(`https://graph.facebook.com/${version}/${phoneId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: upload,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const uploadResult = await uploaded.json() as { id?: string; error?: { message?: string } };
    if (!uploaded.ok || !uploadResult.id || !/^\d{1,30}$/.test(uploadResult.id)) {
      return errorResponse(uploadResult.error?.message || "Meta could not upload the image", 502);
    }

    const waMessageId = await sendWhatsApp({
      to: waId, type: "image", image: { id: uploadResult.id, ...(caption ? { caption } : {}) },
    });
    acceptedMessageId = waMessageId;
    await WhatsAppMessage.updateOne(
      { waMessageId },
      {
        $set: {
          ...(lead ? { leadId: lead._id } : {}), waId, direction: "outbound", type: "image",
          body: caption || "[Image]", mediaId: uploadResult.id, mimeType: image.type,
          sentBy: session.userId, sentByName: session.name,
        },
        $setOnInsert: { status: "sent", occurredAt: new Date() },
      },
      { upsert: true },
    );
    const message = await WhatsAppMessage.findOne({ waMessageId }).lean();
    return NextResponse.json({ message });
  } catch (error) {
    if (acceptedMessageId) {
      console.error("WhatsApp accepted an image but CRM could not store it", error);
      return NextResponse.json({ accepted: true, waMessageId: acceptedMessageId, error: "WhatsApp accepted the image, but the CRM could not save its history. Do not resend it yet." }, { status: 202 });
    }
    return errorResponse("Image could not be sent through WhatsApp", 502);
  }
}
