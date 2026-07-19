import { NextRequest, NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { User } from "@/models/User";

const updateUser=z.object({
  password:z.string().min(10).max(128).optional(),
  active:z.boolean().optional(),
}).strict().refine(value=>value.password!==undefined||value.active!==undefined,{message:"No changes supplied"});

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
    if(parsed.data.password)target.passwordHash=await bcrypt.hash(parsed.data.password,12);
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
  try {
    await connectMongo(); const target=await User.findById(id);
    if(!target)return NextResponse.json({error:"Staff account not found"},{status:404});
    if(target.role==="super_admin")return NextResponse.json({error:"The super administrator account cannot be deleted"},{status:403});
    if(target.role==="admin"&&session.role!=="super_admin")return NextResponse.json({error:"Only a super administrator can delete an administrator"},{status:403});
    await target.deleteOne();
    return NextResponse.json({deleted:true});
  } catch {return NextResponse.json({error:"Could not delete staff account"},{status:500});}
}
