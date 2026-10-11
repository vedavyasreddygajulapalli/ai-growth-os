// This is a coverage heuristic, not search-volume or competitor ranking data.
export function coverageCandidates(records:any[],pages:any[]) {
  return records.filter(r=>["keywords","topics"].includes(r.kind)&&r.status!=="archived").flatMap(r=>{
    const term=r.title.trim().toLowerCase();
    if(!term||pages.some(p=>`${p.data?.title||""} ${p.data?.description||""}`.toLowerCase().includes(term)))return [];
    return [{recordId:String(r._id),title:r.title,kind:r.kind,reason:"No exact phrase match in the sampled page titles or descriptions.",recommendation:"Review page content and brand fit before planning a new page.",confidence:"candidate",sampledPages:pages.length}];
  });
}
