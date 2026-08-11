import { Schema, model, models } from "mongoose";

const assigneeSchema=new Schema({
  userId:{type:Schema.Types.ObjectId,ref:"User",required:true},name:{type:String,required:true},email:{type:String,required:true},
},{_id:false});

const commentSchema=new Schema({
  text:{type:String,required:true,trim:true,maxlength:3000},authorId:{type:Schema.Types.ObjectId,ref:"User",required:true},authorName:{type:String,required:true},createdAt:{type:Date,default:Date.now},
});

const taskSchema=new Schema({
  title:{type:String,required:true,trim:true,maxlength:180},description:{type:String,trim:true,maxlength:5000},
  status:{type:String,enum:["To do","In progress","Blocked","Completed"],default:"To do",index:true},
  priority:{type:String,enum:["Low","Medium","High","Urgent"],default:"Medium",index:true},
  progress:{type:Number,min:0,max:100,default:0},dueAt:{type:Date,index:true},links:[{type:String,trim:true,maxlength:1000}],
  assignees:[assigneeSchema],createdBy:{type:Schema.Types.ObjectId,ref:"User",required:true,index:true},createdByName:{type:String,required:true},createdByEmail:{type:String,required:true},
  comments:[commentSchema],completedAt:Date,
},{timestamps:true});

taskSchema.index({"assignees.userId":1,status:1,dueAt:1});
export const Task=models.Task||model("Task",taskSchema);
