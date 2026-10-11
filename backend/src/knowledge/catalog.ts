import { z } from "zod";
export type Field = { key: string; label: string; type: "text"|"long"|"url"|"date"|"number"|"select"; options?: string[] };
export type Definition = { label: string; module: "brand"|"research"|"strategy"; singleton?: boolean; fields: Field[] };
const fields = (names: string): Field[] => names.split("|").map(part => {
  const [key,label,type = "long"] = part.split(":"); return {key,label,type:type as Field["type"]};
});
const def = (label:string,module:Definition["module"],names:string,singleton=false):Definition => ({label,module,singleton,fields:fields(names)});
export const catalog: Record<string,Definition> = {
  business: def("Business profile","brand","industry:Industry:text|description:Description|positioning:Positioning|valueProposition:Value proposition|differentiators:Differentiators|markets:Markets|locations:Locations|goals:Goals",true),
  services: def("Services","brand","description:Description|features:Features|benefits:Benefits|pains:Pains solved|audiences:Audiences|keywords:Keywords|url:Service URL:url|pricing:Pricing notes"),
  products: def("Products","brand","description:Description|features:Features|benefits:Benefits|pains:Pains solved|audiences:Audiences|keywords:Keywords|url:Product URL:url|pricing:Pricing notes"),
  audiences: def("Target audiences","brand","persona:Persona|role:Role:text|industry:Industry:text|pains:Pains|needs:Needs|objections:Objections|motivations:Motivations|intent:Intent:text|funnel:Funnel stage:text"),
  competitors: def("Competitors","brand","url:Website:url|positioning:Positioning|strengths:Strengths|weaknesses:Weaknesses|trackedUrls:Tracked URLs|notes:Notes"),
  voice: def("Brand voice","brand","tone:Tone|personality:Personality|vocabulary:Vocabulary|preferred:Preferred phrases|banned:Banned phrases|writing:Writing rules|formatting:Formatting rules",true),
  claims: def("Claims library","brand","claim:Claim|evidence:Evidence|sourceUrl:Source URL:url|usage:Allowed usage|restrictions:Restrictions|reviewDate:Review date:date"),
  proof: def("Proof library","brand","proofType:Proof type:text|description:Evidence|result:Measurable result|sourceUrl:Source URL:url|permission:Usage permission|reviewDate:Review date:date"),
  sources: def("Knowledge sources","brand","sourceType:Source type:text|url:Source URL:url|content:Knowledge text|freshness:Freshness notes|reviewDate:Review date:date"),
  media: def("Media library","brand","url:Asset URL:url|mediaType:Media type:text|folder:Folder:text|tags:Tags|alt:Alt text|caption:Caption|rights:Usage rights|usage:Usage references"),
  design: def("Design profile","brand","logoUrl:Logo URL:url|colors:Brand colors|typography:Typography|imageStyle:Image style|buttons:CTA and button rules|do:Visual guidance|dont:Avoid",true),
  projects: def("Research projects","research","researchType:Research type:text|market:Market:text|audience:Audience|owner:Owner user ID:text|startDate:Start date:date|endDate:End date:date|description:Research brief"),
  keywords: def("Keywords","research","source:Data source:text|volume:Search volume:number|difficulty:Difficulty:number|intent:Intent:text|relevance:Relevance:number|brandFit:Brand fit:number|targetUrl:Target page:url|notes:Notes"),
  topics: def("Topics and clusters","research","description:Description|intent:Intent:text|keywords:Keywords|pillarUrl:Pillar page:url|notes:Cluster notes"),
  groups: def("Keyword groups","research","keywords:Keywords|intent:Intent:text|description:Description"),
  findings: def("Research findings","research","finding:Finding|evidence:Evidence|sourceUrl:Source URL:url|confidence:Confidence:number|notes:Limitations"),
  opportunities: def("Market opportunities","research","evidence:Evidence|impact:Impact:number|effort:Effort:number|priority:Priority:number|action:Recommended action"),
  recommendations: def("Recommendations","strategy","rationale:Rationale|evidence:Evidence|impact:Impact:number|effort:Effort:number|confidence:Confidence:number|priority:Priority:number|owner:Owner user ID:text"),
  tasks: def("Tasks and calendar","strategy","description:Description|owner:Owner user ID:text|priority:Priority:number|startDate:Start date:date|dueDate:Due date:date|outcome:Outcome"),
};
export const statuses = ["draft","in_review","approved","in_progress","completed","archived"] as const;
export function dataSchema(kind:string) {
  const d=catalog[kind]; if(!d) throw Error("Unknown kind");
  const shape:Record<string,z.ZodType>={};
  for(const f of d.fields) {
    let s:z.ZodType=f.type==="number"?z.number().finite().min(0).max(f.key==="volume"?1e12:100):f.type==="url"?z.string().max(2048).refine(v=>{try{const u=new URL(v);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}},"Use an HTTP(S) URL"):f.type==="date"?z.iso.date():z.string().trim().max(f.type==="text"?200:8000);
    shape[f.key]=s.optional();
  }
  return z.object(shape).strict().superRefine((data,ctx)=>{
    for(const [a,b] of [["startDate","endDate"],["startDate","dueDate"]]) if(data[a]&&data[b]&&String(data[a])>String(data[b]))ctx.addIssue({code:"custom",path:[b],message:"End must be on or after start"});
  });
}
