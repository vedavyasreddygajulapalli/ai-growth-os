import mongoose from "mongoose";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fail } from "../contracts";
export const mediaBucket=()=>new mongoose.mongo.GridFSBucket(mongoose.connection.db!,{bucketName:"brand_media"});
export function decodeAsset(base64:string,type:string){
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))fail(422,"INVALID_FILE","Invalid file encoding.");
  const bytes=Buffer.from(base64,"base64");
  if(!bytes.length||bytes.length>2*1024*1024)fail(422,"FILE_TOO_LARGE","Files must be between 1 byte and 2 MB.");
  const valid=type==="image/png"?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==="image/jpeg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==="image/webp"?bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP":type==="application/pdf"?bytes.toString("ascii",0,5)==="%PDF-":false;
  if(!valid)fail(422,"INVALID_FILE","Use a valid PNG, JPEG, WebP or PDF file.");
  return bytes;
}
export async function storeAsset(bytes:Buffer,filename:string,orgId:string,websiteId:string){
  const stream=mediaBucket().openUploadStream(filename,{metadata:{orgId,websiteId}});
  try{await pipeline(Readable.from(bytes),stream);return stream.id;}catch(e){await stream.abort().catch(()=>{});throw e;}
}
