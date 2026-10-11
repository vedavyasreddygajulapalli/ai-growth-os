import mongoose,{Schema} from 'mongoose';
const oid=Schema.Types.ObjectId;
const schema=new Schema({orgId:{type:oid,required:true},websiteId:{type:oid,required:true},issueId:{type:oid,required:true},status:{type:String,enum:['open','in_progress','ignored','resolved'],default:'open'},assigneeId:{type:oid,default:null},reason:{type:String,default:''},version:{type:Number,default:0},checkedJobId:oid,checkedAt:Date,updatedBy:oid},{timestamps:true,strict:true});
schema.index({orgId:1,websiteId:1,issueId:1},{unique:true});
export const SeoIssueWorkflow=mongoose.model('SeoIssueWorkflow',schema,'seo_issue_workflows');
