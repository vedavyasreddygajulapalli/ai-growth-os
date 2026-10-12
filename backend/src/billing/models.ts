import mongoose,{Schema} from "mongoose";
const oid=Schema.Types.ObjectId;
const subscription=new Schema({orgId:{type:oid,required:true},provider:{type:String,enum:["stripe"],required:true},customerId:String,subscriptionId:String,planId:String,status:{type:String,enum:["trialing","active","past_due","canceled","incomplete","unpaid"],required:true},currency:String,periodStart:Date,periodEnd:Date,latestInvoice:{id:String,status:String,currency:String,amountPaidMinor:Number,hostedUrl:String},billingContact:String,version:{type:Number,default:0}},{timestamps:true,strict:"throw",versionKey:false});
subscription.index({orgId:1},{unique:true});
subscription.index({provider:1,customerId:1},{unique:true,partialFilterExpression:{customerId:{$type:"string"}}});
export const Subscription=mongoose.model("Subscription",subscription,"subscriptions");
const usage=new Schema({orgId:{type:oid,required:true},websiteId:{type:oid,required:true},meter:{type:String,required:true},quantity:{type:Number,required:true,min:0},unit:{type:String,default:"operations"},eventKey:{type:String,required:true},period:{type:String,required:true},reservationState:{type:String,enum:["reserved","settled","released"],required:true},sourceId:{type:oid,required:true}},{timestamps:true,strict:"throw",versionKey:false});
usage.index({orgId:1,eventKey:1},{unique:true});
usage.index({orgId:1,period:1,meter:1});
export const UsageRecord=mongoose.model("UsageRecord",usage,"usage_records");
const webhook=new Schema({provider:{type:String,required:true},externalEventId:{type:String,required:true},status:{type:String,enum:["processed"],default:"processed"},payloadHash:{type:String,required:true},processedAt:Date},{timestamps:true,strict:"throw",versionKey:false});
webhook.index({provider:1,externalEventId:1},{unique:true});
export const BillingWebhookEvent=mongoose.model("BillingWebhookEvent",webhook,"webhook_events");
export interface BillingCheckoutRequest {orgId:string;planId:string;billingContact?:string;currency?:string}
export interface BillingCheckoutResult {status:"available"|"unavailable";url:string|null;reason:string|null}
export interface BillingProviderAdapter {readonly provider:string;checkout(input:BillingCheckoutRequest):Promise<BillingCheckoutResult>}
export class UnavailableBillingProviderAdapter implements BillingProviderAdapter {
 readonly provider="stripe";
 async checkout(_input:BillingCheckoutRequest):Promise<BillingCheckoutResult>{return {status:"unavailable",url:null,reason:"Billing checkout is not configured for this workspace."};}
}
