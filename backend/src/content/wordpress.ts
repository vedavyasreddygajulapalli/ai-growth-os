import {lookup} from 'node:dns/promises';
import https from 'node:https';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {publicAddress} from '../crawler/safe-fetch';
function key(){const v=Buffer.from(process.env.CMS_ENCRYPTION_KEY||'','base64');if(v.length!==32)throw Error('CMS_NOT_CONFIGURED');return v;}
export function seal(value:string,scope:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);c.setAAD(Buffer.from(scope));return [iv.toString('base64'),Buffer.concat([c.update(value,'utf8'),c.final()]).toString('base64'),c.getAuthTag().toString('base64')].join('.');}
export function unseal(value:string,scope:string){const parts=value.split('.');if(parts.length!==3||parts.some(p=>Buffer.from(p,'base64').toString('base64')!==p)||Buffer.from(parts[0],'base64').length!==12||Buffer.from(parts[2],'base64').length!==16)throw Error('CMS_INVALID_SECRET');const [iv,data,tag]=parts;const c=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64'));c.setAAD(Buffer.from(scope));c.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([c.update(Buffer.from(data,'base64')),c.final()]).toString();}
export type WpTransport=(connection:any,path:string,method?:string,body?:any)=>Promise<any>;
let testTransport:WpTransport|undefined;
export function setTestWpTransport(value?:WpTransport){if(process.env.NODE_ENV!=='test')throw Error('Test transport forbidden');testTransport=value;}
export const wordpress:WpTransport=async(c,path,method='GET',body)=>{
 if(testTransport)return testTransport(c,path,method,body);
 const u=new URL(c.origin+'/wp-json/wp/v2/'+path);
 if(u.protocol!=='https:'||u.origin!==c.origin||u.username||u.password||u.port)throw Error('UNSAFE_CMS_URL');
 const addresses=await Promise.race([lookup(u.hostname,{all:true,verbatim:true}),new Promise<never>((_,reject)=>{const t=setTimeout(()=>reject(Error('CMS_DNS_TIMEOUT')),5000);t.unref();})]);
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('UNSAFE_CMS_ADDRESS');
 const secret=unseal(c.encryptedSecret,String(c.orgId)+':'+String(c.websiteId));
 return new Promise((resolve,reject)=>{
  const binary=body?.bytes instanceof Buffer;if(binary&&(body.bytes.length>2*1024*1024||!/^growth-[a-f0-9-]+\.(png|jpg|webp)$/.test(body.filename)))throw Error('CMS_INVALID_UPLOAD');
  const data=binary?body.bytes:body?JSON.stringify(body):undefined;
  const req=https.request(u,{method,agent:false,lookup:((_h:any,_o:any,cb:any)=>cb(null,addresses[0].address,addresses[0].family)) as any,headers:{Authorization:'Basic '+Buffer.from(c.username+':'+secret).toString('base64'),'Content-Type':binary?body.contentType:'application/json',...(binary?{'Content-Disposition':'attachment; filename="'+body.filename+'"'}:{}),'Accept-Encoding':'identity','User-Agent':'AIGrowthOS/1.0'}},res=>{
   if((res.statusCode||0)>=300){res.resume();reject(Error('CMS_HTTP_'+res.statusCode));return;}
   let count=0;const chunks:Buffer[]=[];res.on('data',chunk=>{count+=chunk.length;if(count>2*1024*1024){res.destroy();reject(Error('CMS_RESPONSE_TOO_LARGE'));}else chunks.push(chunk);});res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(Error('CMS_INVALID_RESPONSE'));}});res.on('error',()=>reject(Error('CMS_RESPONSE_LOST')));
  });const timer=setTimeout(()=>req.destroy(),15000);req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(Error(method==='GET'?'CMS_UNAVAILABLE':'CMS_OUTCOME_UNKNOWN')));req.end(data);
 });
};
export function cmsError(e:unknown){const message=e instanceof Error?e.message:'';return /^(CMS_|UNSAFE_CMS_)[A-Z0-9_]+$/.test(message)?message:'CMS_REQUEST_FAILED';}
