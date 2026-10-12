import mongoose,{Schema} from "mongoose";
const oid=Schema.Types.ObjectId,scoped={orgId:{type:oid,required:true},websiteId:{type:oid,required:true}};
const policy=new Schema({...scoped,mode:{type:String,enum:["manual","assisted"],default:"manual"},allowedActions:{type:[String],default:[]},maxSpendMinor:{type:Number,default:0,min:0},maxPages:{type:Number,default:0,min:0,max:1000},protectedUrls:{type:[String],default:[]},version:{type:Number,default:0},updatedBy:{type:oid,required:true}},{timestamps:true,strict:"throw"});
policy.index({orgId:1,websiteId:1},{unique:true});
export const AgentPolicy=mongoose.model("AgentPolicy",policy,"agent_policies");
const proposal=new Schema({...scoped,action:{type:String,enum:["content_draft","seo_schema_draft","technical_fix","lead_follow_up"],required:true},input:{type:Schema.Types.Mixed,required:true},inputHash:{type:String,required:true},rationale:{type:String,required:true,maxlength:2000},impact:{type:String,required:true,maxlength:1000},costMinor:{type:Number,required:true,min:0},status:{type:String,enum:["proposed","approved","rejected","changes_requested"],default:"proposed"},version:{type:Number,default:0},createdBy:{type:oid,required:true},decidedBy:oid,decisionReason:String,decidedAt:Date},{timestamps:true,strict:"throw"});
proposal.index({orgId:1,websiteId:1,status:1,_id:-1});
export const AgentProposal=mongoose.model("AgentProposal",proposal,"agent_proposals");
