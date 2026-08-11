import { NextRequest,NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { requireSameOrigin,requireSession,rateLimit } from "@/lib/api-security";
import { Task } from "@/models/Task";
import { User } from "@/models/User";
import { sendTaskAssignment } from "@/lib/email";

const createTask=z.object({title:z.string().trim().min(3).max(180),description:z.string().trim().max(5000).default(""),priority:z.enum(["Low","Medium","High","Urgent"]).default("Medium"),dueAt:z.string().datetime(),assigneeIds:z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(10),links:z.array(z.string().trim().url().max(1000)).max(10).default([])}).strict();

export async function GET(request:NextRequest){
  const session=await requireSession(request);if(session instanceof NextResponse)return session;
  try{await connectMongo();const all=session.role==="super_admin"||session.role==="admin";const filter=all?{}:{$or:[{createdBy:session.userId},{"assignees.userId":session.userId}]};const tasks=await Task.find(filter).sort({status:1,dueAt:1,updatedAt:-1}).limit(500).lean();return NextResponse.json({tasks});}catch{return NextResponse.json({error:"Could not load tasks"},{status:500});}
}

export async function POST(request:NextRequest){
  const session=await requireSession(request);if(session instanceof NextResponse)return session;
  if(!requireSameOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const limited=rateLimit(request,`task-create:${session.userId}`,30,60_000);if(limited)return limited;
  const parsed=createTask.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"Enter valid task details"},{status:400});
  try{await connectMongo();const users=await User.find({_id:{$in:parsed.data.assigneeIds},active:true}).select("name email").lean();if(users.length!==new Set(parsed.data.assigneeIds).size)return NextResponse.json({error:"One or more assignees are invalid"},{status:400});const assignees=users.map(user=>({userId:user._id,name:user.name,email:user.email}));const task=await Task.create({...parsed.data,assigneeIds:undefined,assignees,dueAt:new Date(parsed.data.dueAt),createdBy:session.userId,createdByName:session.name,createdByEmail:session.email,comments:[{text:"Task created",authorId:session.userId,authorName:session.name}]});const recipients=assignees.filter(item=>String(item.userId)!==session.userId).map(item=>item.email);let emailStatus:"sent"|"skipped"|"failed"=recipients.length?"sent":"skipped";if(recipients.length){try{await sendTaskAssignment({emails:recipients,title:task.title,creator:session.name,dueAt:task.dueAt,taskUrl:`${String(process.env.APP_URL||"https://crm.aimsglobal.com.np").replace(/\/$/,"")}/`});}catch{emailStatus="failed";}}return NextResponse.json({task,emailStatus},{status:201});}catch{return NextResponse.json({error:"Could not create task"},{status:500});}
}
