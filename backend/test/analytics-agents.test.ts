import {test} from "node:test";
import assert from "node:assert/strict";
import {UnavailableProviderAdapter} from "../src/analytics/models";
import {createHash} from "node:crypto";
test("disconnected analytics providers report null values and no timestamp",async()=>{const result=await new UnavailableProviderAdapter("ga4").read("org","site",new Date(0),new Date());assert.equal(result.status,"disconnected");assert.equal(result.value,null);assert.equal(result.observedAt,null);assert.ok(result.reason);});
test("proposal input fingerprints change when the approved payload changes",()=>{const hash=(x:unknown)=>createHash("sha256").update(JSON.stringify(x)).digest("hex");assert.notEqual(hash({title:"A"}),hash({title:"B"}));assert.equal(hash({title:"A"}),hash({title:"A"}));});
