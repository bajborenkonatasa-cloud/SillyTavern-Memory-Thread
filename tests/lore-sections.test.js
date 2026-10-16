import test from 'node:test';
import assert from 'node:assert/strict';
import {previewLoreSections} from '../living-lorebook.js';
import {emptyMemory,ensureIds,source} from '../core.js';
function fixture(){const chat=[{mes:'Роэн подарил кольцо',name:'Роэн',is_user:false,extra:{}}];ensureIds(chat);const src=source(chat[0],0);const mem=emptyMemory();const base={sources:[src],manual:false,disabled:false,certainty:'fact',participants:['Роэн'],knownTo:[],keywords:[],created:1};mem.records=[{...base,id:'a',key:'item:ring',title:'Кольцо',category:'item',text:'Кольцо'}, {...base,id:'b',key:'event:gift',title:'Дар',category:'event',text:'Дар кольца'}, {...base,id:'c',key:'secret:s',title:'Тайна',category:'secret',text:'Секрет',knownTo:['Ханаби']}];return {chat,mem};}
test('shows confirmed links, plot and secret knowledge without exposing secret as link',()=>{const {chat,mem}=fixture();const view=previewLoreSections(mem,chat);assert.equal(view.links.length,1);assert.equal(view.plot.length,1);assert.deepEqual(view.secrets[0].knownTo,['Ханаби']);});
test('deleted source excludes every projected section',()=>{const {mem}=fixture();const view=previewLoreSections(mem,[]);assert.equal(view.links.length,0);assert.equal(view.secrets.length,0);assert.equal(view.plot.length,0);});
