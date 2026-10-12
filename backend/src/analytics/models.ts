import mongoose,{Schema} from "mongoose";
const oid=Schema.Types.ObjectId;
const scoped={orgId:{type:oid,required:true},websiteId:{type:oid,required:true}};
const connection=new Schema({...scoped,provider:{type:String,enum:["ga4"],required:true},status:{type:String,enum:["disconnected","authorization_required","connected","error"],default:"disconnected"},property:String,updatedBy:{type:oid,required:true},version:{type:Number,default:0}},{timestamps:true,strict:"throw"});
connection.index({orgId:1,websiteId:1,provider:1},{unique:true});
export const AnalyticsProviderConnection=mongoose.model("AnalyticsProviderConnection",connection,"analytics_provider_connections");
const definition=new Schema({...scoped,key:{type:String,required:true,maxlength:80},name:{type:String,required:true,maxlength:120},kind:{type:String,enum:["lead","event"],required:true},enabled:{type:Boolean,default:true},version:{type:Number,default:0},updatedBy:{type:oid,required:true}},{timestamps:true,strict:"throw"});
definition.index({orgId:1,websiteId:1,key:1},{unique:true});
export const ConversionDefinition=mongoose.model("ConversionDefinition",definition,"conversion_definitions");
const report=new Schema({...scoped,name:{type:String,required:true,maxlength:160},sections:{type:[String],default:[]},period:{from:{type:Date,required:true},to:{type:Date,required:true}},timezone:{type:String,required:true},format:{type:String,enum:["json","csv"],default:"json"},status:{type:String,enum:["ready","failed"],default:"ready"},snapshot:{type:Schema.Types.Mixed,required:true},createdBy:{type:oid,required:true},version:{type:Number,default:0}},{timestamps:true,strict:"throw"});
report.index({orgId:1,websiteId:1,_id:-1});
export const AnalyticsReport=mongoose.model("AnalyticsReport",report,"analytics_reports");
export interface ProviderSnapshot<T>{provider:string;status:"available"|"disconnected"|"authorization_required"|"unavailable";observedAt:Date|null;value:T|null;reason:string|null}
export interface AnalyticsProviderAdapter<T>{readonly provider:string;read(orgId:string,websiteId:string,from:Date,to:Date):Promise<ProviderSnapshot<T>>}
export class UnavailableProviderAdapter<T> implements AnalyticsProviderAdapter<T>{
 constructor(readonly provider:string,private status:ProviderSnapshot<T>["status"]="disconnected",private reason="Connect this provider to view verified measurements."){}
 async read(_orgId:string,_websiteId:string,_from:Date,_to:Date):Promise<ProviderSnapshot<T>>{return {provider:this.provider,status:this.status,observedAt:null,value:null,reason:this.reason};}
}
