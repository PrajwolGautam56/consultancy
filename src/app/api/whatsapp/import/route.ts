import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp";
import { Lead } from "@/models/Lead";

const schema = z.object({
  contacts: z.array(z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(24) }).strict()).min(1).max(1000),
  consentConfirmed: z.literal(true),
  consentSource: z.string().trim().min(3).max(120),
}).strict();

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Only administrators and managers can import campaign contacts" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check every name and phone number, then confirm WhatsApp consent" }, { status: 400 });

  const unique = new Map<string, { name: string; phone: string }>();
  for (const contact of parsed.data.contacts) {
    const phone = normalizeWhatsAppPhone(contact.phone);
    if (phone.length >= 10 && phone.length <= 15) unique.set(phone, { name: contact.name, phone });
  }
  if (!unique.size) return NextResponse.json({ error: "No valid phone numbers were found" }, { status: 400 });

  await connectMongo(); const now = new Date(); const imported: string[] = []; let created = 0; let matched = 0;
  const contacts = [...unique.values()];
  for (let index = 0; index < contacts.length; index += 20) {
    const batch = contacts.slice(index, index + 20);
    const results = await Promise.all(batch.map(async (contact) => {
      const local = contact.phone.startsWith("977") ? contact.phone.slice(3) : contact.phone;
      const existing = await Lead.findOne({ phone: { $in: [contact.phone, `+${contact.phone}`, local, `0${local}`] }, archivedAt: null }).select("_id");
      if (existing) {
        await Lead.updateOne({ _id: existing._id }, { $set: { whatsappOptIn: true, whatsappOptInAt: now, whatsappOptInSource: parsed.data.consentSource, whatsappOptOutAt: null } });
        return { id: String(existing._id), created: false };
      }
      try {
        const lead = await Lead.create({ name: contact.name, phone: contact.phone, source: "Other", whatsappOptIn: true, whatsappOptInAt: now, whatsappOptInSource: parsed.data.consentSource, createdBy: session.userId, activities: [{ type: "note", text: `Bulk imported for WhatsApp campaign; consent source: ${parsed.data.consentSource}`, authorId: session.userId, authorName: session.name }] });
        return { id: String(lead._id), created: true };
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const duplicate = await Lead.findOne({ phone: contact.phone }).select("_id");
        return duplicate ? { id: String(duplicate._id), created: false } : null;
      }
    }));
    for (const result of results) if (result) { imported.push(result.id); if (result.created) created += 1; else matched += 1; }
  }
  return NextResponse.json({ leadIds: imported, total: imported.length, created, matched, skipped: unique.size - imported.length });
}
