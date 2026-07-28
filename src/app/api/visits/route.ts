import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { requireSession } from "@/lib/api-security";
import { Lead } from "@/models/Lead";

const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function GET(request:NextRequest) {
  const session=await requireSession(request); if(session instanceof NextResponse)return session;
  const parsed=dateSchema.safeParse(request.nextUrl.searchParams.get("date"));
  if(!parsed.success)return NextResponse.json({error:"A valid date is required"},{status:400});
  const start=new Date(`${parsed.data}T00:00:00+05:45`); const end=new Date(start.getTime()+86_400_000);
  const access=["counsellor","manager"].includes(session.role)?{$or:[
    {assignedTo:session.userId},{followUpAssignedTo:session.userId},
    {counsellor:session.name},{followUpAssignee:session.name},
  ]}:{};
  try {
    await connectMongo();
    const visits=await Lead.aggregate([
      {$match:{...access,activities:{$elemMatch:{type:"visit",text:"Visitor checked in",occurredAt:{$gte:start,$lt:end}}}}},
      {$unwind:"$activities"},
      {$match:{"activities.type":"visit","activities.text":"Visitor checked in","activities.occurredAt":{$gte:start,$lt:end}}},
      {$sort:{"activities.occurredAt":-1}},
      {$limit:500},
      {$project:{_id:0,id:{$toString:"$activities._id"},leadId:{$toString:"$_id"},name:1,phone:1,email:1,country:1,course:1,counsellor:1,inOffice:1,checkedInAt:"$activities.occurredAt",checkedInBy:"$activities.authorName"}},
    ]);
    return NextResponse.json({date:parsed.data,count:visits.length,visits});
  } catch {return NextResponse.json({error:"Could not load visitor history"},{status:500});}
}
