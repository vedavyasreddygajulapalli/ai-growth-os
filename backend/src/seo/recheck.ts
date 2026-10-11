// A missing URL or failed/partial crawl is not evidence that an issue was fixed.
export function canResolve(job:any,page:any,issuePresent:boolean){
 return job?.status==='completed' && job.config?.mode==='full' && !job.truncated && page?.status==='crawled' && page.data?.statusCode>=200 && page.data.statusCode<300 && /text\/html/i.test(page.data?.contentType||'') && !issuePresent;
}
