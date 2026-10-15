import test from 'node:test';
import assert from 'node:assert/strict';
import {previewLorebook} from '../living-lorebook.js';
import {source, fingerprint} from '../core.js';
const m=(id,mes)=>({name:'Кира',is_user:true,mes,extra:{memoryThreadId:id}});
const record=(id,key,src,created=1)=>({id,key,title:key,category:'item',text:key,keywords:[],sources:[src],created,manual:false,disabled:false,locked:false,pinned:false});
test('a branch never sees facts from messages after its fork',()=>{
  const chat=[m('a','первое'),m('b','второе'),m('c','третье')];
  const mem={records:[record('old','кольцо',source(chat[0],0)),record('future','машина',source(chat[2],2))],dismissed:[]};
  assert.deepEqual(previewLorebook(mem,chat.slice(0,2)).map(x=>x.id),['old']);
  assert.equal(previewLorebook(mem,[m('z','другой чат')]).length,0);
});
test('editing a message invalidates its lore',()=>{
  const chat=[m('a','оригинал')];
  const mem={records:[record('r','кольцо',source(chat[0],0))],dismissed:[]};
  assert.equal(previewLorebook(mem,chat).length,1);
  assert.equal(previewLorebook(mem,[m('a','новая версия')]).length,0);
});
test('manual unanchored notes do not leak into generated lore',()=>{
  const mem={records:[{...record('r','дом',{id:'absent',hash:'x',index:0}),manual:true,sources:[]}],dismissed:[]};
  assert.equal(previewLorebook(mem,[m('a','текст')]).length,0);
});
