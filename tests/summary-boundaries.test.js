import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContext,emptyMemory} from '../core.js';
const count=async s=>s.length/3;
const settings={budget:10000,autoRecall:true,compactOverview:false};
function fixture(){
 const m=emptyMemory();
 m.records=[{id:'secret1',category:'secret',title:'Тайное письмо',text:'Тайное письмо лежит в башне',knownTo:['Ханаби'],participants:['Ханаби'],keywords:['письмо'],importance:'high',certainty:'fact',sources:[],manual:true,pinned:true,disabled:false,created:1}];
 m.overviews=[{text:'Тайное письмо лежит в башне',sources:[],created:1}];
 m.batches=[{id:'b1',sources:[],scene:'Тайное письмо лежит в башне',summary:'Тайное письмо лежит в башне',created:1}];
 return m;
}
test('unaware character never receives secret via unstructured overview or scene',async()=>{
 const r=await buildContext(fixture(),[],settings,count,[],'Роэн');
 assert.equal(r.guardedSummaries,true);
 assert.doesNotMatch(r.text,/Тайное письмо лежит в башне/);
 assert.ok(r.tokens<=settings.budget);
});
test('knowing character retains summary and pinned secret',async()=>{
 const r=await buildContext(fixture(),[],settings,count,[],'Ханаби');
 assert.equal(r.guardedSummaries,false);
 assert.match(r.text,/Тайное письмо лежит в башне/);
});
test('no secret means no suppression',async()=>{
 const m=fixture();m.records=[{...m.records[0],id:'public',category:'event',title:'Публичное событие',knownTo:[],pinned:true}];
 const r=await buildContext(m,[],settings,count,[],'Роэн');
 assert.equal(r.guardedSummaries,false);
 assert.match(r.text,/Тайное письмо лежит в башне/);
});
