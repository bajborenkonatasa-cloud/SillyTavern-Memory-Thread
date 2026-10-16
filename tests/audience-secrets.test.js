import test from 'node:test';
import assert from 'node:assert/strict';
import {canShareSecret,buildContext,emptyMemory,DEFAULTS} from '../core.js';
const secret={id:'s',key:'s',title:'Письмо',category:'secret',text:'Тайное письмо',participants:['Ханаби'],knownTo:['Ханаби'],keywords:['письмо'],sources:[],manual:true,pinned:true,disabled:false,importance:'high',certainty:'fact',created:1};
test('Only explicitly named knower receives a private fact',()=>{
 assert.equal(canShareSecret(secret,'Ханаби'),true);
 assert.equal(canShareSecret(secret,'Роэн'),false);
 assert.equal(canShareSecret(secret,null),false);
 assert.equal(canShareSecret({...secret,knownTo:[]},'Ханаби'),false);
 assert.equal(canShareSecret({...secret,category:'item'},'Роэн'),true);
});
test('Pinned private memory cannot bypass audience filter',async()=>{
 const memory={...emptyMemory(),records:[secret]};
 const count=t=>Math.ceil(t.length/3);
 const config={...DEFAULTS,budget:2000,autoRecall:true};
 const blocked=await buildContext(memory,[],config,count,[],'Роэн');
 const allowed=await buildContext(memory,[],config,count,[],'Ханаби');
 const unknown=await buildContext(memory,[],config,count,[],null);
 assert.equal(blocked.text.includes('Тайное письмо'),false);
 assert.equal(unknown.text.includes('Тайное письмо'),false);
 assert.equal(allowed.text.includes('Тайное письмо'),true);
});
