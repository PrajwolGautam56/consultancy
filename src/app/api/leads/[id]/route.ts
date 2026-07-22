import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidObjectId } from "mongoose";
import { connectMongo } from "@/lib/mongodb";
import { Lead } from "@/models/Lead";
import { requireSameOrigin, requireSession } from "@/lib/api-security";
import { sendVisitThankYou } from "@/lib/email";

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().min(7).max(24).optional(),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(), address: z.string().trim().max(300).optional(),
  education: z.string().trim().max(300).optional(), passedOutInstitute: z.string().trim().max(200).optional(), country: z.string().trim().max(100).optional(), course: z.string().trim().max(200).optional(), university: z.string().trim().max(200).optional(),
  source: z.enum(["Facebook", "Instagram", "Phone call", "Walk-in", "Referral", "Website", "Other"]).optional(),
  stage: z.enum(["New inquiry", "Contacted", "Counselling", "Application", "Enrolled", "Lost"]).optional(),
  priority: z.enum(["Low", "Medium", "High"]).optional(), counsellor: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  inOffice: z.boolean().optional(), nextFollowUp: z.union([z.string().datetime(), z.null()]).optional(),
  assignedTo: z.union([z.string().regex(/^[a-f\d]{24}$/i),z.null()]).optional(),
  followUpAssignedTo: z.union([z.string().regex(/^[a-f\d]{24}$/i),z.null()]).optional(), followUpAssignee:z.string().trim().max(120).optional(),
  activity: z.object({ type: z.enum(["note", "call", "visit", "stage", "follow_up", "assignment"]), text: z.string().trim().min(1).max(2000) }).optional(),
}).strict();

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const session=await requireSession(request); if(session instanceof NextResponse)return session;
  if(!requireSameOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const {id}=await params; if(!isValidObjectId(id))return NextResponse.json({error:"Invalid lead id"},{status:400});
  const parsed=updateSchema.safeParse(await request.json()); if(!parsed.success)return NextResponse.json({error:"Invalid update",fields:parsed.error.flatten().fieldErrors},{status:400});
  if(session.role==="receptionist") {
    const allowed=new Set(["inOffice","activity","tags"]); const forbidden=Object.keys(parsed.data).some(key=>!allowed.has(key));
    if(forbidden)return NextResponse.json({error:"Receptionists can only manage visits and activity notes"},{status:403});
  }
  if(["counsellor","manager"].includes(session.role)&&(parsed.data.assignedTo!==undefined||parsed.data.counsellor!==undefined))return NextResponse.json({error:"Only an administrator can change the student owner"},{status:403});
  try {
    await connectMongo(); const existing=await Lead.findById(id).select("inOffice name email assignedTo followUpAssignedTo counsellor followUpAssignee").lean() as null|{inOffice?:boolean;name?:string;email?:string;assignedTo?:unknown;followUpAssignedTo?:unknown;counsellor?:string;followUpAssignee?:string};
    if(!existing)return NextResponse.json({error:"Lead not found"},{status:404});
    if(["counsellor","manager"].includes(session.role)&&String(existing.assignedTo||"")!==session.userId&&String(existing.followUpAssignedTo||"")!==session.userId&&String(existing.counsellor||"")!==session.name&&String(existing.followUpAssignee||"")!==session.name)return NextResponse.json({error:"This student is not assigned to you"},{status:403});
    const {activity,...fields}=parsed.data; const setFields:Record<string,unknown>={...fields};
    if(fields.tags)setFields.tags=Array.from(new Set(fields.tags.map(tag=>tag.trim()).filter(Boolean)));
    if(fields.phone)setFields.phone=fields.phone.replace(/[\s()-]/g,""); if(fields.email!==undefined)setFields.email=fields.email.toLowerCase()||undefined;
    if(fields.inOffice!==undefined)setFields.checkedInAt=fields.inOffice?new Date():null;
    const update:Record<string,unknown>={$set:setFields};
    if(activity)update.$push={activities:{...activity,authorId:session.userId,authorName:session.name,occurredAt:new Date()}};
    const lead=await Lead.findByIdAndUpdate(id,update,{new:true,runValidators:true}).lean();
    if(!lead)return NextResponse.json({error:"Lead not found"},{status:404});
    let emailStatus:"not_requested"|"skipped"|"sent"|"failed"="not_requested";
    if(existing.inOffice===true&&fields.inOffice===false) {
      try {
        const result=await sendVisitThankYou({name:String(existing.name),email:String(existing.email||"")}); emailStatus=result.status;
        if(result.status==="sent")await Lead.updateOne({_id:id},{$push:{activities:{type:"note",text:"Thank-you email sent after office checkout",authorId:session.userId,authorName:session.name,occurredAt:new Date()}}});
      } catch {emailStatus="failed";console.warn("Visit thank-you email could not be sent");}
    }
    return NextResponse.json({lead,emailStatus});
  } catch(error) { if((error as {code?:number}).code===11000)return NextResponse.json({error:"Phone or email is already in use"},{status:409}); return NextResponse.json({error:"Could not update lead"},{status:500}); }
}
