import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContext,emptyMemory} from '../core.js';
const count=async s=>Math.ceil(s.length/4);
const base={budget:2000,autoRecall:true,autoFlashbacks:false};
const make=(id,keyword,importance='high')=>({id,key:id,title:id,text:`Достоверный факт: ${keyword}`,category:'event',participants:[],knownTo:[],keywords:[keyword],importance,certainty:'fact',sources:[],manual:true,pinned:false,disabled:false,created:1});
test('unrelated high importance does not fill budget',async()=>{
 const mem=emptyMemory();mem.records=[make('Старая охота','охота')];
 const result=await buildContext(mem,[{mes:'Мы обсуждаем кольцо',is_user:true}],base,count);
 assert.deepEqual(result.selected,[]);assert.ok(!result.text.includes('Старая охота'));
});
test('matching record is recalled before overview',async()=>{
 const mem=emptyMemory();mem.records=[make('Кольцо','кольцо')];
 mem.overviews=[{text:'Очень длинная сводка. '.repeat(1000),sources:[],created:1}];
 const result=await buildContext(mem,[{mes:'Где кольцо?',is_user:true}],{...base,budget:500},count);
 assert.ok(result.selected.includes('Кольцо'));
 assert.ok(result.tokens<=500);
});
test('usage is returned and sums approximately to total',async()=>{
 const mem=emptyMemory();mem.records=[make('Кольцо','кольцо')];
 const result=await buildContext(mem,[{mes:'Где кольцо?',is_user:true}],base,count);
 assert.ok(result.usage.recall>0);assert.ok(result.usage.header>0);
 assert.ok(Math.abs(Object.values(result.usage).reduce((a,b)=>a+b,0)-result.tokens)<=1);
});
