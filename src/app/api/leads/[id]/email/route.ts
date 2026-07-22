import { NextRequest, NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSameOrigin, requireSession, rateLimit } from "@/lib/api-security";
import { connectMongo } from "@/lib/mongodb";
import { sendCustomStudentEmail } from "@/lib/email";
import { Lead } from "@/models/Lead";

const emailSchema=z.object({
  subject:z.string().trim().min(3).max(150),
  message:z.string().trim().min(1).max(5000),
}).strict();

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const session=await requireSession(request); if(session instanceof NextResponse)return session;
  if(!requireSameOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const limited=rateLimit(request,`student-email:${session.userId}`,20,60*60*1000); if(limited)return limited;
  const {id}=await params; if(!isValidObjectId(id))return NextResponse.json({error:"Invalid student id"},{status:400});
  const parsed=emailSchema.safeParse(await request.json());
  if(!parsed.success)return NextResponse.json({error:"Enter a valid subject and message"},{status:400});
  try {
    await connectMongo();
    const lead=await Lead.findById(id).select("name email assignedTo followUpAssignedTo counsellor followUpAssignee");
    if(!lead)return NextResponse.json({error:"Student not found"},{status:404});
    if(["counsellor","manager"].includes(session.role)&&String(lead.assignedTo||"")!==session.userId&&String(lead.followUpAssignedTo||"")!==session.userId&&lead.counsellor!==session.name&&lead.followUpAssignee!==session.name)return NextResponse.json({error:"This student is not assigned to you"},{status:403});
    if(!lead.email)return NextResponse.json({error:"Add an email address to this student before sending"},{status:400});
    await sendCustomStudentEmail({name:lead.name,email:lead.email,...parsed.data});
    const activity={type:"note",text:`Email sent · ${parsed.data.subject}`,authorId:session.userId,authorName:session.name,occurredAt:new Date()};
    await Lead.updateOne({_id:id},{$push:{activities:activity}});
    return NextResponse.json({sent:true,activity});
  } catch(error) {
    console.error("Student email send failed",error instanceof Error?error.message:"Unknown error");
    return NextResponse.json({error:"Email could not be sent. Check the sender domain and email configuration."},{status:502});
  }
}
