import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { Lead } from "@/models/Lead";
import { WhatsAppGroup } from "@/models/WhatsAppGroup";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const color = z.enum(["green", "blue", "violet", "orange", "rose"]);
const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(180).default(""),
  color: color.default("green"),
}).strict();
const updateSchema = z.object({
  id: objectId,
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(180).optional(),
  color: color.optional(),
  memberIds: z.array(objectId).max(5000).optional(),
}).strict();

function denied() {
  return NextResponse.json({ error: "Only administrators and managers can manage WhatsApp groups" }, { status: 403 });
}

function serialize(group: { _id: unknown; name: string; description?: string; color?: string; memberIds?: unknown[]; updatedAt?: Date }) {
  return {
    _id: String(group._id), name: group.name, description: group.description || "",
    color: group.color || "green", memberIds: (group.memberIds || []).map(String),
    memberCount: group.memberIds?.length || 0, updatedAt: group.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return denied();
  await connectMongo();
  const groups = await WhatsAppGroup.find().sort({ name: 1 }).lean();
  return NextResponse.json({ groups: groups.map((group) => serialize(group as never)) });
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return denied();
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid group name" }, { status: 400 });
  await connectMongo();
  try {
    const group = await WhatsAppGroup.create({ ...parsed.data, memberIds: [], createdBy: session.userId, updatedBy: session.userId });
    return NextResponse.json({ group: serialize(group) }, { status: 201 });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return NextResponse.json({ error: "A group with this name already exists" }, { status: 409 });
    throw error;
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return denied();
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid group details" }, { status: 400 });
  await connectMongo();
  const { id, memberIds, ...details } = parsed.data;
  let verifiedMembers: string[] | undefined;
  if (memberIds) {
    const leads = await Lead.find({ _id: { $in: memberIds }, archivedAt: null }).select("_id").lean();
    verifiedMembers = leads.map((lead) => String(lead._id));
  }
  try {
    const group = await WhatsAppGroup.findByIdAndUpdate(id, {
      $set: { ...details, ...(verifiedMembers ? { memberIds: verifiedMembers } : {}), updatedBy: session.userId },
    }, { new: true, runValidators: true });
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    return NextResponse.json({ group: serialize(group) });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return NextResponse.json({ error: "A group with this name already exists" }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return denied();
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id") || "";
  if (!objectId.safeParse(id).success) return NextResponse.json({ error: "Invalid group" }, { status: 400 });
  await connectMongo();
  const deleted = await WhatsAppGroup.findByIdAndDelete(id);
  if (!deleted) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
