// Safe, local cleanup helpers. No API calls and no automatic loss of unique memories.
import {activeRecords, norm, recordText} from './core.js';

const arr=x=>Array.isArray(x)?x:[];
const sorted=a=>arr(a).map(String).sort().join('|');
const sourceSig=r=>arr(r.sources).map(s=>`${s.id}:${s.hash}:${s.index}`).sort().join('|');
const contentSig=r=>[
  r.key,r.category,norm(r.title),norm(r.text),norm(r.date),sorted(r.participants),sorted(r.knownTo),
  sorted(r.keywords),norm(r.quote),norm(r.quoteSpeaker),r.importance,r.certainty,sourceSig(r)
].join('§');
const priority=r=>(r.manual?100:0)+(r.locked?50:0)+(r.pinned?20:0)+(r.importance==='high'?5:r.importance==='medium'?2:0)+(Number(r.created)||0)/1e15;

function words(text){return new Set((norm(text).match(/[\p{L}\p{N}]{3,}/gu)||[]).filter(Boolean));}
function jaccard(a,b){if(!a.size&&!b.size)return 0;let hit=0;for(const w of a)if(b.has(w))hit++;return hit/(a.size+b.size-hit||1);}
function overlap(a,b){const A=new Set(arr(a).map(norm).filter(Boolean)),B=new Set(arr(b).map(norm).filter(Boolean));for(const x of A)if(B.has(x))return true;return false;}

export function analyzeBroom(mem,chat){
  const exact=[];
  const groups=new Map();
  for(const r of arr(mem.records)){
    const sig=contentSig(r);if(!groups.has(sig))groups.set(sig,[]);groups.get(sig).push(r);
  }
  for(const list of groups.values())if(list.length>1){
    const keep=list.slice().sort((a,b)=>priority(b)-priority(a))[0];
    for(const r of list)if(r.id!==keep.id)exact.push(r.id);
  }
  const recordKeys=new Set(arr(mem.records).map(r=>r.key));
  const staleDismissed=arr(mem.dismissed).filter(k=>!recordKeys.has(k));
  const active=activeRecords(mem,chat);
  const similar=[];
  for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
    const a=active[i],b=active[j];
    if(a.key===b.key||a.category!==b.category)continue;
    const titleSame=norm(a.title)&&norm(a.title)===norm(b.title);
    const participantHit=overlap(a.participants,b.participants);
    const sim=jaccard(words(recordText(a)),words(recordText(b)));
    let score=Math.round(sim*100)+(titleSame?35:0)+(participantHit?10:0);
    if((titleSame&&sim>=.2)||(participantHit&&sim>=.55)||sim>=.72)similar.push({a,b,score:Math.min(100,score)});
  }
  similar.sort((x,y)=>y.score-x.score);
  const seen=new Set(),pairs=[];
  for(const p of similar){const k=[p.a.id,p.b.id].sort().join('|');if(seen.has(k))continue;seen.add(k);pairs.push(p);if(pairs.length>=12)break;}
  return {exactDuplicateIds:exact,staleDismissed,similarPairs:pairs,activeCount:active.length,totalVersions:arr(mem.records).length};
}

export function applySafeBroom(mem,report,{removeExact=true,removeStaleDismissed=true}={}){
  const drop=new Set(removeExact?report.exactDuplicateIds:[]);
  if(drop.size)mem.records=arr(mem.records).filter(r=>!drop.has(r.id));
  if(removeStaleDismissed&&report.staleDismissed.length){const stale=new Set(report.staleDismissed);mem.dismissed=arr(mem.dismissed).filter(k=>!stale.has(k));}
  mem.revision=(Number(mem.revision)||0)+1;
  return {removedExact:drop.size,removedStale:removeStaleDismissed?report.staleDismissed.length:0};
}
