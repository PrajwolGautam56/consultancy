import { NextRequest, NextResponse } from "next/server";
import mongoose, { isValidObjectId } from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { User } from "@/models/User";
import { Lead } from "@/models/Lead";
import { Task } from "@/models/Task";

const updateUser=z.object({
  password:z.string().min(10).max(128).optional(),
  active:z.boolean().optional(),
}).strict().refine(value=>value.password!==undefined||value.active!==undefined,{message:"No changes supplied"});
const deleteUser=z.object({transferToUserId:z.string().regex(/^[a-f\d]{24}$/i)}).strict();

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const session=await requireSession(request); if(session instanceof NextResponse)return session;
  if(!isPrivileged(session.role))return NextResponse.json({error:"Administrator access required"},{status:403});
  if(!requireSameOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const {id}=await params; if(!isValidObjectId(id))return NextResponse.json({error:"Invalid staff id"},{status:400});
  const parsed=updateUser.safeParse(await request.json()); if(!parsed.success)return NextResponse.json({error:"Password must be at least 10 characters"},{status:400});
  if(id===session.userId&&parsed.data.active===false)return NextResponse.json({error:"You cannot deactivate your own account"},{status:400});
  try {
    await connectMongo(); const target=await User.findById(id);
    if(!target)return NextResponse.json({error:"Staff account not found"},{status:404});
    if(target.role==="super_admin"&&session.role!=="super_admin")return NextResponse.json({error:"Only a super administrator can modify this account"},{status:403});
    if(parsed.data.password){target.passwordHash=await bcrypt.hash(parsed.data.password,12);target.currentSessionId=undefined;}
    if(parsed.data.active!==undefined)target.active=parsed.data.active;
    await target.save();
    return NextResponse.json({user:{_id:target._id,name:target.name,email:target.email,phone:target.phone,role:target.role,active:target.active,lastLoginAt:target.lastLoginAt,createdAt:target.createdAt}});
  } catch {return NextResponse.json({error:"Could not update staff account"},{status:500});}
}

export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const session=await requireSession(request); if(session instanceof NextResponse)return session;
  if(!isPrivileged(session.role))return NextResponse.json({error:"Administrator access required"},{status:403});
  if(!requireSameOrigin(request))return NextResponse.json({error:"Invalid request origin"},{status:403});
  const {id}=await params; if(!isValidObjectId(id))return NextResponse.json({error:"Invalid staff id"},{status:400});
  if(id===session.userId)return NextResponse.json({error:"You cannot delete your own account"},{status:400});
  const parsed=deleteUser.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Select a team member to receive this staff member’s work"},{status:400});
  if(parsed.data.transferToUserId===id)return NextResponse.json({error:"Transfer target must be a different team member"},{status:400});
  try {
    await connectMongo(); const target=await User.findById(id);
    if(!target)return NextResponse.json({error:"Staff account not found"},{status:404});
    if(target.role==="super_admin")return NextResponse.json({error:"The super administrator account cannot be deleted"},{status:403});
    if(target.role==="admin"&&session.role!=="super_admin")return NextResponse.json({error:"Only a super administrator can delete an administrator"},{status:403});
    const replacement=await User.findOne({_id:parsed.data.transferToUserId,active:true});
    if(!replacement)return NextResponse.json({error:"The selected transfer recipient is not active"},{status:400});
    const dbSession=await mongoose.startSession();let transferSummary={leads:0,followUps:0,tasks:0};
    try{await dbSession.withTransaction(async()=>{
      const ownerResult=await Lead.updateMany({$or:[{assignedTo:target._id},{counsellor:target.name},{createdBy:target._id,assignedTo:{$exists:false}}]},{$set:{assignedTo:replacement._id,counsellor:replacement.name},$push:{activities:{type:"assignment",text:`Student ownership transferred from ${target.name} to ${replacement.name}`,authorId:session.userId,authorName:session.name,occurredAt:new Date()}}},{session:dbSession});
      const followUpResult=await Lead.updateMany({$or:[{followUpAssignedTo:target._id},{followUpAssignee:target.name}]},{$set:{followUpAssignedTo:replacement._id,followUpAssignee:replacement.name},$push:{activities:{type:"assignment",text:`Follow-up transferred from ${target.name} to ${replacement.name}`,authorId:session.userId,authorName:session.name,occurredAt:new Date()}}},{session:dbSession});
      const tasks=await Task.find({$or:[{createdBy:target._id},{"assignees.userId":target._id}]}).session(dbSession);
      for(const task of tasks){const hadAssignee=task.assignees.some((item:{userId:unknown})=>String(item.userId)===id);if(hadAssignee){task.assignees=task.assignees.filter((item:{userId:unknown})=>String(item.userId)!==id);if(!task.assignees.some((item:{userId:unknown})=>String(item.userId)===String(replacement._id)))task.assignees.push({userId:replacement._id,name:replacement.name,email:replacement.email});}if(String(task.createdBy)===id){task.createdBy=replacement._id;task.createdByName=replacement.name;task.createdByEmail=replacement.email;}task.comments.push({text:`Work handed over from ${target.name} to ${replacement.name}`,authorId:session.userId,authorName:session.name,createdAt:new Date()});await task.save({session:dbSession});}
      await User.deleteOne({_id:target._id},{session:dbSession});transferSummary={leads:ownerResult.modifiedCount,followUps:followUpResult.modifiedCount,tasks:tasks.length};
    });}finally{await dbSession.endSession();}
    return NextResponse.json({deleted:true,transferredTo:{_id:replacement._id,name:replacement.name},transferSummary});
  } catch {return NextResponse.json({error:"Could not delete staff account"},{status:500});}
}
