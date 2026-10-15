import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContext,emptyMemory,source,activeRecords,coverage} from '../core.js';

const msg=(id,mes,hidden=false)=>({name:'Роэн',is_user:true,mes,is_hidden:hidden,extra:{memoryThreadId:id}});
const memoryFor=(chat)=>{
  const memory=emptyMemory();
  memory.records.push({id:'ring',key:'ring',title:'Фамильное кольцо',category:'item',text:'Кольцо принадлежит Роэну.',keywords:['фамильное кольцо'],participants:[],knownTo:['Роэн'],importance:'medium',certainty:'fact',sources:[source(chat[0],0)],manual:false,locked:false,pinned:false,disabled:false,created:1});
  memory.batches.push({id:'batch',sources:[source(chat[0],0)],summary:'Кольцо подарено.',scene:'',date:'',created:1});
  return memory;
};
const settings={budget:2000,autoRecall:true,autoFlashbacks:false};
const count=t=>Math.ceil(t.length/2.5);

test('/hide preserves saved memories and coverage',async()=>{
  const chat=[msg('a','Роэн подарил фамильное кольцо.',true),msg('b','Ты помнишь фамильное кольцо?')];
  const memory=memoryFor(chat);
  assert.equal(activeRecords(memory,chat).length,1);
  assert.equal(coverage(memory,chat)[0].covered,true);
  const result=await buildContext(memory,chat,settings,count);
  assert.deepEqual(result.selected,['ring']);
});

test('/unhide does not invalidate source or create a second record',async()=>{
  const chat=[msg('a','Роэн подарил фамильное кольцо.',true),msg('b','Помнишь фамильное кольцо?')];
  const memory=memoryFor(chat);
  chat[0].is_hidden=false;
  const result=await buildContext(memory,chat,settings,count);
  assert.deepEqual(result.selected,['ring']);
  assert.equal(result.text.split('Кольцо принадлежит Роэну.').length-1,1);
});

test('hidden recent text does not activate lore triggers',async()=>{
  const chat=[msg('a','Роэн подарил фамильное кольцо.',true),msg('b','Что будем делать завтра?')];
  const memory=memoryFor(chat);
  const result=await buildContext(memory,chat,settings,count);
  assert.deepEqual(result.selected,[]);
});

test('deleted source or alternate branch excludes saved lore',async()=>{
  const original=[msg('a','Роэн подарил фамильное кольцо.'),msg('b','Помнишь фамильное кольцо?')];
  const memory=memoryFor(original);
  const deleted=await buildContext(memory,original.slice(1),settings,count);
  assert.deepEqual(deleted.selected,[]);
  const rewritten=[msg('a','Роэн не дарил никакого кольца.'),original[1]];
  const edited=await buildContext(memory,rewritten,settings,count);
  assert.deepEqual(edited.selected,[]);
});
