import {test} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {UnavailableBillingProviderAdapter} from "../src/billing/models";
import {verifyStripe} from "../src/billing/controller";
test("billing checkout is unavailable without a configured provider",async()=>{const adapter=new UnavailableBillingProviderAdapter();const result=await adapter.checkout({orgId:"org",planId:"pro"});assert.equal(result.status,"unavailable");assert.equal(result.url,null);assert.ok(result.reason);});
test("Stripe webhook signatures bind the raw payload and expire after five minutes",()=>{const raw=Buffer.from('{"id":"evt_example"}'),secret="unit-test-secret",ts=String(Math.floor(Date.now()/1000));const sig=createHmac("sha256",secret).update(ts+".").update(raw).digest("hex");assert.equal(verifyStripe(raw,`t=${ts},v1=${sig}`,secret),true);assert.equal(verifyStripe(Buffer.from('{"id":"evt_other"}'),`t=${ts},v1=${sig}`,secret),false);assert.equal(verifyStripe(raw,`t=${Number(ts)-600},v1=${sig}`,secret),false);assert.equal(verifyStripe(raw,undefined,secret),false);});
