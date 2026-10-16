import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedMemoryBoosts} from '../core.js';
const r=(id,category,text,sources=[{id:'a',hash:'1'}],extra={})=>({id,title:id==='ring'?'Фамильное кольцо':id,category,text,participants:['Роэн'],keywords:id==='ring'?['кольцо']:[],certainty:'fact',sources,...extra});
const boosts=(list)=>linkedMemoryBoosts(list,[{r:list[0],lore:{score:5}}]);
test('same character alone is insufficient to link unrelated scenes',()=>{
 const ring=r('ring','item','Старинное кольцо');
 const unrelated=r('hunt','event','Роэн охотился в лесу',[{id:'b',hash:'2'}]);
 assert.equal(boosts([ring,unrelated]).size,0);
});
test('explicit reference links distinct source ranges, but not substring',()=>{
 const ring=r('ring','item','Старинное кольцо');
 const promise=r('oath','promise','Роэн дал обещание, глядя на кольцо',[{id:'b',hash:'2'}]);
 const noise=r('noise','event','Старое кольцово лежало в сундуке',[{id:'c',hash:'3'}]);
 const result=boosts([ring,promise,noise]);
 assert.ok(result.has('oath'));assert.ok(!result.has('noise'));
});
test('same verified source links, but mismatched hash does not',()=>{
 const ring=r('ring','item','Кольцо');
 const same=r('same','promise','Он дал клятву');
 const changed=r('changed','event','Он ушёл',[{id:'a',hash:'old'}]);
 const result=boosts([ring,same,changed]);
 assert.ok(result.has('same'));assert.ok(!result.has('changed'));
});
test('secrets and uncertain memories are not auto-linked',()=>{
 const ring=r('ring','item','Кольцо');
 const secret=r('secret','secret','Тайна кольца');
 const belief=r('belief','event','Кольцо проклято',[{id:'b',hash:'2'}],{certainty:'belief'});
 assert.equal(boosts([ring,secret,belief]).size,0);
});
