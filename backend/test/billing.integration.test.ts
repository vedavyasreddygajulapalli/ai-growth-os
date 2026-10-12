import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {MongoMemoryReplSet} from "mongodb-memory-server";
import mongoose from "mongoose";
import {createApp} from "../src/app";
import {connectDatabase,Organization,Audit} from "../src/database";
import {runMigrations} from "../src/migrations";
import {BillingWebhookEvent,Subscription} from "../src/billing/models";
process.env.NODE_ENV="test";
process.env.APP_ORIGINS="http://localhost:3000";
const secret="m12-integration-secret";
let repl:MongoMemoryReplSet,app:any,base:string,orgId:string,previousSecret:string|undefined;
before(async()=>{previousSecret=process.env.STRIPE_WEBHOOK_SECRET;process.env.STRIPE_WEBHOOK_SECRET=secret;repl=await MongoMemoryReplSet.create({replSet:{count:1},binary:{version:"7.0.24"}});await connectDatabase(repl.getUri());await runMigrations();const org=await Organization.create({name:"Billing test",timezone:"UTC",currency:"USD"});orgId=String(org._id);app=await createApp();await app.listen(0,"127.0.0.1");base=(await app.getUrl())+"/api/v1";});
after(async()=>{await app?.close();await mongoose.disconnect();await repl?.stop();if(previousSecret===undefined)delete process.env.STRIPE_WEBHOOK_SECRET;else process.env.STRIPE_WEBHOOK_SECRET=previousSecret;});
function sign(raw:Buffer){const timestamp=String(Math.floor(Date.now()/1000));const signature=createHmac("sha256",secret).update(timestamp+".").update(raw).digest("hex");return `t=${timestamp},v1=${signature}`;}
test("signed Stripe webhook bypasses browser-origin checks and projects subscription once",async()=>{const raw=Buffer.from(JSON.stringify({id:"evt_m12_subscription",type:"customer.subscription.updated",data:{object:{id:"sub_m12",customer:"cus_m12",status:"active",metadata:{orgId},current_period_start:1791763200,current_period_end:1794355200,items:{data:[{price:{id:"price_m12_real",lookup_key:"growth",currency:"usd"}}]}}}}));const send=()=>fetch(base+"/billing/webhook/stripe",{method:"POST",headers:{"content-type":"application/json","stripe-signature":sign(raw)},body:raw});const first=await send();assert.equal(first.status,201);assert.deepEqual(await first.json(),{received:true,duplicate:false});const duplicate=await send();assert.equal(duplicate.status,201);assert.deepEqual(await duplicate.json(),{received:true,duplicate:true});const sub=await Subscription.findOne({orgId}).lean();assert.equal(sub?.status,"active");assert.equal(sub?.planId,"growth");assert.equal(sub?.customerId,"cus_m12");assert.equal(await BillingWebhookEvent.countDocuments({externalEventId:"evt_m12_subscription"}),1);assert.equal(await Audit.countDocuments({orgId,action:"billing.subscription.provider_updated"}),1);});
test("invalid signed webhook is rejected before any provider state is written",async()=>{const raw=Buffer.from(JSON.stringify({id:"evt_m12_invalid",type:"customer.subscription.updated",data:{object:{metadata:{orgId}}}}));const r=await fetch(base+"/billing/webhook/stripe",{method:"POST",headers:{"content-type":"application/json","stripe-signature":"t=1,v1=bad"},body:raw});assert.equal(r.status,400);assert.equal(await BillingWebhookEvent.countDocuments({externalEventId:"evt_m12_invalid"}),0);});
