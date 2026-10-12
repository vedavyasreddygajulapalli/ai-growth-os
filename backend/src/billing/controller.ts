import {Controller,Get,Post,Param,Req,Body,UseGuards,Headers,Query} from "@nestjs/common";
import {createHmac,timingSafeEqual,createHash} from "node:crypto";
import {z} from "zod";
import mongoose from "mongoose";
import {AuthGuard,VerifiedGuard,access,managers} from "../security";
import {recordId,parse,fail} from "../contracts";
import {Membership,Organization,transaction,log} from "../database";
import {AiRequest} from "../content/models";
import {Subscription,UsageRecord,BillingWebhookEvent,UnavailableBillingProviderAdapter} from "./models";
const checkoutDto=z.object({planId:z.string().trim().min(1).max(80)}).strict();
const adapter=new UnavailableBillingProviderAdapter();
export function verifyStripe(raw:Buffer|undefined,signature:string|undefined,secret:string|undefined){
 if(!raw||!signature||!secret)return false;
 const parts=signature.split(",").map(x=>x.split("=",2)),ts=parts.find(x=>x[0]==="t")?.[1],sig=parts.filter(x=>x[0]==="v1").map(x=>x[1]);
 if(!ts||!/^\d+$/.test(ts)||Math.abs(Date.now()/1000-Number(ts))>300||!sig.length)return false;
 const expected=createHmac("sha256",secret).update(ts+".").update(raw).digest();
 return sig.some(value=>{if(!/^[a-f0-9]{64}$/i.test(value))return false;const actual=Buffer.from(value,"hex");return actual.length===expected.length&&timingSafeEqual(actual,expected);});
}
@Controller("organizations/:orgId")
@UseGuards(AuthGuard,VerifiedGuard)
export class BillingController {
 @Get("subscription") async subscription(@Req() req:any,@Param("orgId") org:string){
  recordId(org);await access(req,org,managers);
  const s:any=await Subscription.findOne({orgId:org}).lean();
  return {subscription:s?{provider:s.provider,customerId:s.customerId||null,planId:s.planId||null,status:s.status,currency:s.currency||null,periodStart:s.periodStart||null,periodEnd:s.periodEnd||null,billingContact:s.billingContact||null,invoice:s.latestInvoice||null,version:s.version||0}:{provider:"stripe",planId:null,status:"not_configured",currency:null,periodStart:null,periodEnd:null,billingContact:null,invoice:null,version:0},checkoutAvailable:false,providerStatus:"unavailable"};
 }
 @Get("usage-records") async usage(@Req() req:any,@Param("orgId") org:string,@Query() query:any){
  recordId(org);const filter=parse(z.object({period:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),meter:z.enum(["content_ai_success"]).optional()}).strict(),query);await access(req,org,managers);
  // Successful, persisted content AI proposals are the first live V1 meter.
  // Rooting retry attempts at their original request prevents repeat billing.
  const rows:any[]=await AiRequest.find({orgId:org,status:"proposed"}).select("_id websiteId retryOf createdAt").lean();
  const unique=new Map<string,any>();
  for(const r of rows){const root=String(r.retryOf||r._id);if(!unique.has(root))unique.set(root,r);}
  const ops=[...unique].map(([root,r])=>{const d=new Date(r.createdAt);const period=d.toISOString().slice(0,7);return {updateOne:{filter:{orgId:new mongoose.Types.ObjectId(org),eventKey:"content-ai:"+root},update:{$setOnInsert:{orgId:new mongoose.Types.ObjectId(org),websiteId:r.websiteId,meter:"content_ai_success",quantity:1,unit:"operation",eventKey:"content-ai:"+root,period,reservationState:"settled" as const,sourceId:r._id}},upsert:true}}});
  if(ops.length)await UsageRecord.bulkWrite(ops,{ordered:false});
  const records=await UsageRecord.find({orgId:org,...(filter.period?{period:filter.period}:{}),...(filter.meter?{meter:filter.meter}:{})}).sort({period:-1,meter:1,_id:1}).lean();
  const grouped=new Map<string,{period:string;meter:string;used:number;unit:string}>();
  for(const r of records){if(r.reservationState==="released")continue;const k=r.period+"|"+r.meter;const x=grouped.get(k)||{period:r.period,meter:r.meter,used:0,unit:r.unit};x.used+=r.quantity;grouped.set(k,x);}
  return {items:[...grouped.values()].map(x=>({...x,limit:null,resetAt:new Date(Date.UTC(Number(x.period.slice(0,4)),Number(x.period.slice(5,7)),1)).toISOString(),source:"persisted_successful_operations"})),coverage:"current"};
 }
 @Post("billing/checkout") async checkout(@Req() req:any,@Param("orgId") org:string,@Body() body:unknown){
  recordId(org);const d=parse(checkoutDto,body);await access(req,org,managers);
  const result=await adapter.checkout({orgId:org,planId:d.planId});
  if(result.status!=="available"||!result.url)fail(503,"BILLING_UNAVAILABLE",result.reason||"Billing provider unavailable.");
  return {url:result.url};
 }
}
@Controller("billing")
export class BillingWebhookController {
 @Post("webhook/stripe") async stripe(@Req() req:any,@Headers("stripe-signature") signature:string|undefined){
  const raw=req.rawBody as Buffer|undefined,secret=process.env.STRIPE_WEBHOOK_SECRET;
  if(!secret)fail(503,"BILLING_WEBHOOK_UNAVAILABLE","Billing webhook is not configured.");
  if(!verifyStripe(raw,signature,secret))fail(400,"INVALID_WEBHOOK_SIGNATURE","Webhook signature is invalid or expired.");
  let event:any;try{event=JSON.parse(raw!.toString("utf8"));}catch{fail(400,"INVALID_WEBHOOK","Webhook payload is invalid.");}
  if(typeof event?.id!=="string"||typeof event?.type!=="string")fail(400,"INVALID_WEBHOOK","Webhook event is incomplete.");
  const hash=createHash("sha256").update(raw!).digest("hex");
  try{return await transaction(async session=>{
   const exists=await BillingWebhookEvent.findOne({provider:"stripe",externalEventId:event.id}).session(session).lean();
   if(exists){
    if(exists.payloadHash!==hash)fail(409,"WEBHOOK_EVENT_CONFLICT","Webhook event ID was already received with different content.");
    return {received:true,duplicate:true};
   }
   await BillingWebhookEvent.create([{provider:"stripe",externalEventId:event.id,status:"processed",payloadHash:hash,processedAt:new Date()}],{session});
   if(["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"].includes(event.type)){
    const o=event.data?.object||{},org=String(o.metadata?.orgId||"");
    if(!/^[a-f\d]{24}$/i.test(org))fail(400,"INVALID_WEBHOOK","Subscription is missing its workspace reference.");
    if(typeof o.customer!=="string"||!o.customer)fail(400,"INVALID_WEBHOOK","Subscription is missing its provider customer.");
    if(!await Organization.exists({_id:org,status:"active"}).session(session))fail(404,"NOT_FOUND","Workspace unavailable.");
    const status=["trialing","active","past_due","canceled","incomplete","unpaid"].includes(o.status)?o.status:"incomplete";
    const price=o.items?.data?.[0]?.price;
    const sub:any=await Subscription.findOneAndUpdate({orgId:org},{$set:{provider:"stripe",customerId:String(o.customer||""),subscriptionId:String(o.id||""),planId:price?.lookup_key||price?.id||null,status,currency:price?.currency?.toUpperCase()||null,periodStart:o.current_period_start?new Date(o.current_period_start*1000):null,periodEnd:o.current_period_end?new Date(o.current_period_end*1000):null},$inc:{version:1}},{new:true,upsert:true,session,runValidators:true});
    await log(session,req,org,"billing.subscription.provider_updated","subscription",sub._id,null,{status:sub.status,planId:sub.planId,periodEnd:sub.periodEnd});
   }
   return {received:true,duplicate:false};
  });}catch(e:any){
   if(e?.code===11000){
    // A different unique index (for example customer ownership) is not a replay.
    // Only acknowledge after the exact event has committed successfully.
    const committed=await BillingWebhookEvent.findOne({provider:"stripe",externalEventId:event.id}).lean();
    if(committed){
     if(committed.payloadHash!==hash)fail(409,"WEBHOOK_EVENT_CONFLICT","Webhook event ID was already received with different content.");
     return {received:true,duplicate:true};
    }
    fail(409,"BILLING_PROJECTION_CONFLICT","Billing event could not be applied to this workspace.");
   }
   throw e;
  }
 }
}
