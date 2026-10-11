import mongoose, { Schema } from "mongoose";
import { catalog, statuses } from "./catalog";
const schema=new Schema({
  orgId:{type:Schema.Types.ObjectId,required:true},websiteId:{type:Schema.Types.ObjectId,required:true},
  kind:{type:String,enum:Object.keys(catalog),required:true},title:{type:String,required:true},
  status:{type:String,enum:statuses,default:"draft"},data:{type:Schema.Types.Mixed,default:{}},
  references:[{type:Schema.Types.ObjectId}],source:{type:String,default:"manual"},
  fileId:Schema.Types.ObjectId,fileName:String,fileType:String,fileBytes:Number,
  singletonKey:String,version:{type:Number,default:0},updatedBy:{type:Schema.Types.ObjectId,required:true},
},{timestamps:true,strict:"throw",versionKey:false});
schema.index({orgId:1,websiteId:1,kind:1,_id:-1});
schema.index({orgId:1,websiteId:1,singletonKey:1},{unique:true,partialFilterExpression:{singletonKey:{$type:"string"}}});
export const KnowledgeRecord=mongoose.model("KnowledgeRecord",schema,"knowledge_records");
