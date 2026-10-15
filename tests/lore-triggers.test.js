import test from 'node:test';
import assert from 'node:assert/strict';
import {matchLoreTrigger,buildContext,emptyMemory,source} from '../core.js';
const msg=(id,mes,is_user=true)=>({name:is_user?'Ханаби':'Роэн',is_user,mes,extra:{memoryThreadId:id}});
const entry=(id,src)=>({id,key:id,title:'Фамильное кольцо',category:'item',text:'Кольцо принадлежит семье.',keywords:['фамильное кольцо','кольцо'],participants:[],knownTo:['Роэн'],importance:'medium',certainty:'fact',sources:[src],manual:false,locked:false,pinned:false,disabled:false,created:1});
test('complete-word lore trigger and not substring',()=>{
 const r=entry('ring',{});
 assert.equal(matchLoreTrigger(r,'Она спросила про фамильное кольцо').score,5);
 assert.equal(matchLoreTrigger(r,'Увидела кольцо').score,2);
 assert.equal(matchLoreTrigger(r,'кольцовщик'),null);
});
test('lore trigger selects the existing record once, within budget',async()=>{
 const chat=[msg('a','Роэн передал кольцо.'),msg('b','А что с фамильным кольцом?')];
 const mem=emptyMemory();mem.records.push(entry('ring',source(chat[0],0)));
 const result=await buildContext(mem,chat,{budget:2000,autoRecall:true,autoFlashbacks:false},t=>Math.ceil(t.length/2.5));
 assert.deepEqual(result.selected,['ring']);
 assert.match(result.text,/Кольцо принадлежит семье/);
 assert.equal(result.text.split('Кольцо принадлежит семье').length-1,1);
});
test('fork excludes future lore from active context',async()=>{
 const full=[msg('a','Роэн'),msg('b','Кольцо'),msg('c','Фамильное кольцо')];
 const mem=emptyMemory();mem.records.push(entry('future',source(full[2],2)));
 const result=await buildContext(mem,full.slice(0,2),{budget:2000,autoRecall:true,autoFlashbacks:false},t=>Math.ceil(t.length/2.5));
 assert.deepEqual(result.selected,[]);
});
