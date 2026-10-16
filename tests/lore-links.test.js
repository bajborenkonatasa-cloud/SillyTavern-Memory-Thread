import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedMemoryBoosts,matchLoreTrigger,buildContext,emptyMemory,source} from '../core.js';
const msg=(id,mes)=>({name:'Ханаби',is_user:true,mes,extra:{memoryThreadId:id}});
const rec=(id,category,participants,src)=>({id,key:id,title:id==='ring'?'Фамильное кольцо':id,category,text:`Факт ${id}`,keywords:id==='ring'?['кольцо']:[],participants,knownTo:['Роэн'],importance:'medium',certainty:'fact',sources:[src],manual:false,locked:false,pinned:false,disabled:false,created:1});
test('item cue boosts at most two factual memories sharing exact participants',()=>{
 const src={id:'a',hash:'h',index:0};
 const ring=rec('ring','item',['Роэн'],src), promise=rec('promise','promise',['Роэн'],src),event=rec('event','event',['Роэн'],src),other=rec('other','event',['Ханаби'],src),secret=rec('secret','secret',['Роэн'],src);
 const list=[ring,promise,event,other,secret];
 const direct=list.map(r=>({r,lore:matchLoreTrigger(r,'Ты помнишь фамильное кольцо?')}));
 const boosts=linkedMemoryBoosts(list,direct);
 assert.equal(boosts.size,2);assert.ok(boosts.has('promise'));assert.ok(boosts.has('event'));assert.ok(!boosts.has('secret'));assert.ok(!boosts.has('other'));
});
test('no chain without item/place trigger, and no link for belief',()=>{
 const src={id:'a',hash:'h',index:0};const char=rec('person','character',['Роэн'],src), event=rec('event','event',['Роэн'],src);
 assert.equal(linkedMemoryBoosts([char,event],[{r:char,lore:{score:2}}]).size,0);
 event.certainty='belief';const item=rec('ring','item',['Роэн'],src);
 assert.equal(linkedMemoryBoosts([item,event],[{r:item,lore:{score:5}}]).size,0);
});
test('linked memory is included once in existing context, with no extra block',async()=>{
 const chat=[msg('a','Роэн передал фамильное кольцо.'),msg('b','Помнишь фамильное кольцо?')];
 const mem=emptyMemory();const src=source(chat[0],0);
 mem.records.push(rec('ring','item',['Роэн'],src),rec('promise','promise',['Роэн'],src));
 const result=await buildContext(mem,chat,{budget:2000,autoRecall:true,autoFlashbacks:false},t=>Math.ceil(t.length/2.5));
 assert.deepEqual(new Set(result.selected),new Set(['ring','promise']));
 assert.equal(result.text.split('Факт promise').length-1,1);
});
