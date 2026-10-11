import mongoose,{Schema} from 'mongoose';
const oid=Schema.Types.ObjectId;
const schema=new Schema({orgId:{type:oid,required:true},websiteId:{type:oid,required:true},issueId:{type:oid,required:true},status:{type:String,enum:['open','in_progress','ignored','resolved'],default:'open'},assigneeId:{type:oid,default:null},reason:{type:String,default:''},version:{type:Number,default:0},checkedJobId:oid,checkedAt:Date,updatedBy:oid},{timestamps:true,strict:true});
schema.index({orgId:1,websiteId:1,issueId:1},{unique:true});
export const SeoIssueWorkflow=mongoose.model('SeoIssueWorkflow',schema,'seo_issue_workflows');
const draft=new Schema({orgId:{type:oid,required:true},websiteId:{type:oid,required:true},name:{type:String,required:true},url:{type:String,required:true},jsonLd:{type:Schema.Types.Mixed,required:true},status:{type:String,enum:['draft','review','approved','publishing','archived'],default:'draft'},version:{type:Number,default:0},updatedBy:{type:oid,required:true},approvedBy:oid,lastPublishedAt:Date,lastPublishedJobId:oid},{timestamps:true,strict:'throw'});
draft.index({orgId:1,websiteId:1,_id:-1});
export const SeoSchemaDraft=mongoose.model('SeoSchemaDraft',draft,'seo_schema_drafts');

const providerConnection=new Schema({orgId:{type:oid,required:true},websiteId:{type:oid,required:true},provider:{type:String,enum:["search_console","rankings","ai_visibility"],required:true},status:{type:String,enum:["disconnected","authorization_required","connected","error"],default:"disconnected"},property:String,version:{type:Number,default:0},requestedBy:oid,updatedBy:{type:oid,required:true}},{timestamps:true,strict:"throw"});
providerConnection.index({orgId:1,websiteId:1,provider:1},{unique:true});
export const SeoProviderConnection=mongoose.model("SeoProviderConnection",providerConnection,"seo_provider_connections");
