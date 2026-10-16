import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContext,emptyMemory,safeAutomaticRecall} from '../core.js';
const count=async s=>Math.ceil(s.length/4);
const record=(category,knownTo,importance='high')=>({id:category+'-'+knownTo.join('-'),key:category+'-'+knownTo.join('-'),title:'Завещание',text:'Скрытое завещание в сундуке',category,knownTo,participants:['Роэн'],keywords:['завещание'],importance,certainty:'fact',sources:[],manual:true,locked:false,pinned:false,disabled:false,created:1});
const settings={budget:2000,autoRecall:true,autoFlashbacks:false};
test('unknown-owner secret never automatically injected even if high importance',async()=>{
 const mem=emptyMemory();mem.records=[record('secret',[])];
 const result=await buildContext(mem,[{name:'Ханаби',is_user:true,mes:'Что с завещанием?'}],settings,count);
 assert.equal(result.selected.length,0);
 assert.ok(!result.text.includes('Скрытое завещание'));
});
test('known-to secret retains explicit knowledge label, not universal knowledge',async()=>{
 const mem=emptyMemory();mem.records=[record('secret',['Ханаби'])];
 const result=await buildContext(mem,[{name:'Ханаби',is_user:true,mes:'Что с завещанием?'}],settings,count);
 assert.match(result.text,/Знают: Ханаби/);
 assert.match(result.text,/не разрешение другим узнать секрет/);
});
test('unknown-owner secret may be manually forced with warning',async()=>{
 const mem=emptyMemory();mem.records=[record('secret',[])];
 const result=await buildContext(mem,[],settings,count,[{id:mem.records[0].id,mode:'normal'}]);
 assert.match(result.text,/не раскрывать автоматически/);
});
test('non-secret records unaffected',()=>assert.equal(safeAutomaticRecall(record('item',[])),true));
