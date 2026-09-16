// Shared checked boundaries. Harness payloads remain open because original
// records include fields outside the supported projection; they are never erased.
/**
 * @typedef {"codex"|"pi"} Harness
 * @typedef {{commit:string,created_at:string,summary:string,filename:string,number:number,url:string}} RevisionRef
 * @typedef {RevisionRef & {id:string,title:string,description:string,body:string,revision_id:string,revisionCount:number,topic:string,related:string[],questions:string[],sources:object[]}} ArticleRevision
 * @typedef {{id:string,format:Harness,title:string,bytes:number,records:number,session_id:string|null,imported_at:string,url?:string}} TraceMetadata
 * @typedef {{line:number,value:Record<string,any>}} SourceRecord
 * @typedef {SourceRecord & {kind:string,text:string,label:string,timestamp?:unknown,blocks?:Record<string,any>[],branch?:boolean,parentLine?:number,mirrorOf?:number,superseded?:boolean}} TraceEvent
 * @typedef {{id:string,line:number,page:number,imported_at:string,url:string}} Provenance
 * @typedef {{id:string,line:number,page:number,role:string,title:string,format:Harness,session_id:string|null,imported_at:string,snippet:string,logical_key:string,url:string,snapshot_count:number,provenance:Provenance[],provenance_url:string,provenance_nextOffset:number|null}} TraceHit
 * @typedef {{indexed:boolean,results:TraceHit[],nextOffset:number|null,error?:string}} TraceSearchResult
 * @typedef {{id:string,format:Harness,page:number,pages:number,total_records:number,records:TraceEvent[],html:string}} RenderedTrace
 * @typedef {{transport:"file",path:string,directory:string,size:number}} SpoolResult
 * @typedef {ReturnType<typeof import("./trace-disclosure.mjs").disclose>} DisclosedTrace
 * @typedef {{disclosure?:ReturnType<typeof import("./trace-disclosure.mjs").disclosureOptions>,root:string,metadata:TraceMetadata,page?:number,start?:number,end?:number,directory?:string}} WorkerRequest
 * @typedef {{type:"result",result:RenderedTrace|DisclosedTrace|SpoolResult|null,size:number}|{type:"error",error:string,code?:string,status?:number}} WorkerMessage
 */
export {};
