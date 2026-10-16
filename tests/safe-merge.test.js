import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeKnowledgeScopes,canShareKnowledge,EXTRACTION_PROMPT} from '../core.js';
const r=(category,knownTo)=>({category,knownTo});
test('merge preserves only common confirmed audience',()=>{
 const known=mergeKnowledgeScopes([r('event',['Роэн','Ханаби']),r('secret',['Ханаби'])]);
 assert.deepEqual(known,['Ханаби']);
 assert.equal(canShareKnowledge({...r('event',known)},'Роэн'),false);
});
test('incompatible private audiences cannot be merged',()=>{
 assert.equal(mergeKnowledgeScopes([r('secret',['Роэн']),r('secret',['Ханаби'])]),null);
});
test('unknown owner secret cannot be merged into public record',()=>{
 assert.equal(mergeKnowledgeScopes([r('secret',[]),r('event',[])]),null);
});
test('unclassified records cannot widen private merged audience',()=>{
 assert.deepEqual(mergeKnowledgeScopes([r('event',[]),r('secret',['Роэн'])]),['Роэн']);
});
test('unrestricted records retain legacy audience semantics',()=>{
 assert.deepEqual(mergeKnowledgeScopes([r('event',[]),r('item',[])]),[]);
});
test('extraction asks for no private facts in broad summaries',()=>{
 assert.match(EXTRACTION_PROMPT,/Keep secrets out of the general summary/);
});
