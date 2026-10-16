import test from 'node:test';
import assert from 'node:assert/strict';
import {canShareKnowledge,buildContext,emptyMemory,DEFAULTS} from '../core.js';
const config={...DEFAULTS,budget:10000,autoRecall:true,compactOverview:false};
const count=async s=>Math.ceil(s.length/3);
const entry=(category,knownTo,pinned=true)=>({id:'x',key:'x',category,title:'Личное признание',text:'Роэн спрятал письмо под подушкой',participants:['Роэн'],knownTo,keywords:['письмо'],sources:[],manual:true,pinned,disabled:false,importance:'high',certainty:'fact',created:1});
test('explicit knowledge lists restrict non-secret events and objects',()=>{
 for(const category of ['event','item','relationship','character','promise']){
  assert.equal(canShareKnowledge(entry(category,['Ханаби']),'Роэн'),false);
  assert.equal(canShareKnowledge(entry(category,['Ханаби']),'Ханаби'),true);
 }
});
test('legacy unclassified non-secret records remain available, but unknown secrets do not',()=>{
 assert.equal(canShareKnowledge(entry('event',[]),'Роэн'),true);
 assert.equal(canShareKnowledge(entry('secret',[]),'Роэн'),false);
});
test('pinned and forced restricted ordinary records do not leak, including summaries',async()=>{
 const m=emptyMemory();m.records=[entry('event',['Ханаби'])];
 m.overviews=[{text:'Роэн спрятал письмо под подушкой',sources:[],created:1}];
 const blocked=await buildContext(m,[],config,count,[{id:'x',mode:'flash'}],'Роэн');
 assert.equal(blocked.guardedSummaries,true);
 assert.doesNotMatch(blocked.text,/Роэн спрятал письмо под подушкой/);
 const allowed=await buildContext(m,[],config,count,[],'Ханаби');
 assert.match(allowed.text,/Роэн спрятал письмо под подушкой/);
});
test('unknown group audience cannot read restricted ordinary memories',async()=>{
 const m=emptyMemory();m.records=[entry('item',['Ханаби'])];
 const r=await buildContext(m,[],config,count,[],null);
 assert.doesNotMatch(r.text,/Роэн спрятал письмо под подушкой/);
});
test('knowledge guard never exceeds token budget',async()=>{
 const m=emptyMemory();m.records=[entry('event',['Ханаби'])];
 const r=await buildContext(m,[],{...config,budget:450},count,[],'Роэн');
 assert.ok(r.tokens<=450);
});
