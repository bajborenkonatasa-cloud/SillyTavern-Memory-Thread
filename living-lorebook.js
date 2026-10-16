// Living Lorebook phase 1: read-only, branch-safe projection of existing memories.
// No persistence, no additional model requests, and no extra prompt injection.
import {activeRecords, sourceMap, validSources, norm} from './core.js';
const TYPES = new Set(['character','place','item']);
export function previewLorebook(memory, chat) {
  const current = sourceMap(chat);
  const cards = new Map();
  for (const record of activeRecords(memory, chat)) {
    if (!TYPES.has(record.category)) continue;
    // Do not promote manually entered, unanchored records into branch-dependent lore.
    if (!validSources(record.sources, current)) continue;
    const identity = `${record.category}:${norm(record.key || record.title)}`;
    const previous = cards.get(identity);
    if (!previous || (record.created || 0) >= (previous.created || 0)) {
      cards.set(identity, {
        id: record.id, key: record.key, title: record.title,
        category: record.category, text: record.text,
        keywords: [...new Set(record.keywords || [])],
        sources: record.sources.map(s => ({...s})), created: record.created
      });
    }
  }
  return [...cards.values()];
}

// Shared contextual matching lives in the core context builder.
export {matchLoreTrigger} from './core.js';

// Phase 14: local read-only thematic views; never modify memory or prompts.
export function previewLoreSections(memory, chat) {
  const records=activeRecords(memory,chat).filter(r=>validSources(r.sources,sourceMap(chat)));
  const sourceSet=r=>new Set((r.sources||[]).map(s=>`${s.id}:${s.hash}`));
  const links=[];
  for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++){
    const a=records[i],b=records[j];
    if(['secret','dream'].includes(a.category)||['secret','dream'].includes(b.category))continue;
    if(a.certainty!=='fact'||b.certainty!=='fact')continue;
    const overlap=[...sourceSet(a)].some(x=>sourceSet(b).has(x));
    if(!overlap)continue;
    links.push({a:a.title,b:b.title,reason:'Общий подтверждённый источник'});
    if(links.length>=40)break;
  }
  const only=categories=>records.filter(r=>categories.includes(r.category));
  return {
    links,
    world:only(['place','world','faction','organization']),
    secrets:only(['secret']).map(r=>({...r,knownTo:[...(r.knownTo||[])]})),
    plot:only(['event','promise','conflict','relationship','quest','goal']),
  };
}
