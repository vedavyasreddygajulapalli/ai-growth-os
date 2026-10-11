import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, dataSchema } from "../src/knowledge/catalog";
test("knowledge contracts reject unknown fields, unsafe URLs, fabricated numeric ranges and reversed dates",()=>{
  assert.equal(Object.keys(catalog).length,19);
  assert.equal(dataSchema("business").safeParse({industry:"Technology",orgId:"override"}).success,false);
  assert.equal(dataSchema("media").safeParse({url:"javascript:alert(1)"}).success,false);
  assert.equal(dataSchema("keywords").safeParse({difficulty:101}).success,false);
  assert.equal(dataSchema("keywords").safeParse({source:"Manual research"}).success,true);
  assert.equal(dataSchema("tasks").safeParse({startDate:"2026-12-01",dueDate:"2026-11-01"}).success,false);
});

import {coverageCandidates} from "../src/knowledge/analysis";
test("coverage candidates retain source IDs and do not invent measurements",()=>{
 const results=coverageCandidates([{_id:"one",title:"Brand strategy",kind:"topics",status:"draft"},{_id:"two",title:"New service",kind:"keywords",status:"draft"}],[{data:{title:"Brand strategy guide"}}]);
 assert.deepEqual(results.map(r=>r.recordId),["two"]);assert.equal(results[0].confidence,"candidate");assert.equal("volume" in results[0],false);
});
import {decodeAsset} from "../src/knowledge/media";
test("media rejects executable formats, mismatched signatures and oversized files",()=>{
 assert.throws(()=>decodeAsset(Buffer.from("<script>alert(1)</script>").toString("base64"),"image/png"));
 assert.throws(()=>decodeAsset("not base64", "application/pdf"));
 assert.throws(()=>decodeAsset(Buffer.alloc(2*1024*1024+1).toString("base64"),"image/png"));
 assert.equal(decodeAsset(Buffer.from("%PDF-1.7 test").toString("base64"),"application/pdf").length,13);
});
