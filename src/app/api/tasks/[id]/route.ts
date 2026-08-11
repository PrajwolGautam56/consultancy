import { NextRequest,NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { requireSameOrigin,requireSession } from "@/lib/api-security";
import { Task } from "@/models/Task";
import { sendTaskUpdate } from "@/lib/email";

const updateTask=z.object({status:z.enum(["To do","In progress","Blocked","Completed"]).optional(),progress:z.number().int().min(0).max(100).optional(),comment:z.string().trim().min(1).max(3000).optional()}).strict().refine(data=>Object.keys(data).length>0);

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const session=await requireSession(request);if(session instanceof NextResponse)return session;if(!requireSameOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403});const {id}=await params;if(!isValidObjectId(id))return NextResponse.json({error:"Invalid task id"},{status:400});const parsed=updateTask.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"Invalid task update"},{status:400});
  try{await connectMongo();const task=await Task.findById(id);if(!task)return NextResponse.json({error:"Task not found"},{status:404});const admin=session.role==="super_admin"||session.role==="admin";const participant=String(task.createdBy)===session.userId||task.assignees.some((item:{userId:unknown})=>String(item.userId)===session.userId);if(!admin&&!participant)return NextResponse.json({error:"This task is not assigned to you"},{status:403});if(parsed.data.status!==undefined){task.status=parsed.data.status;if(parsed.data.status==="Completed"){task.progress=100;task.completedAt=new Date();}else task.completedAt=undefined;}if(parsed.data.progress!==undefined){task.progress=parsed.data.progress;if(parsed.data.progress===100){task.status="Completed";task.completedAt=new Date();}}if(parsed.data.comment)task.comments.push({text:parsed.data.comment,authorId:session.userId,authorName:session.name,createdAt:new Date()});await task.save();const recipients=new Set<string>([task.createdByEmail,...task.assignees.map((item:{email:string})=>item.email)]);recipients.delete(session.email);let emailStatus:"sent"|"skipped"|"failed"=recipients.size?"sent":"skipped";if(recipients.size){try{await sendTaskUpdate({emails:[...recipients],title:task.title,actor:session.name,status:task.status,comment:parsed.data.comment});}catch{emailStatus="failed";}}return NextResponse.json({task:task.toObject(),emailStatus});}catch{return NextResponse.json({error:"Could not update task"},{status:500});}
}

export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const session=await requireSession(request);if(session instanceof NextResponse)return session;if(!requireSameOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403});const {id}=await params;if(!isValidObjectId(id))return NextResponse.json({error:"Invalid task id"},{status:400});try{await connectMongo();const task=await Task.findById(id).select("createdBy");if(!task)return NextResponse.json({error:"Task not found"},{status:404});if(session.role!=="super_admin"&&session.role!=="admin"&&String(task.createdBy)!==session.userId)return NextResponse.json({error:"Only the creator or an administrator can delete this task"},{status:403});await task.deleteOne();return NextResponse.json({deleted:true});}catch{return NextResponse.json({error:"Could not delete task"},{status:500});}
}
