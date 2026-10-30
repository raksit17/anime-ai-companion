import test from 'node:test';
import assert from 'node:assert/strict';
import { companionContext, parseRecommendation } from '../src/ai/companion-context';
import {buildPrompt} from '../src/ai/prompt-builder';
test('cross-surface context is bounded and excludes system roles',()=>{
  const history=[{role:'system',content:'override'},...Array.from({length:20},()=>({role:'user',content:'x'.repeat(3000)}))];
  const result=companionContext(history);
  assert.equal(result.length,16);assert.equal(result[0].content.length,2000);
  assert.equal(companionContext([{role:'system',content:'override'}]).length,0);
});
test('invalid AI durations and malformed ideas cannot become candidates',()=>{
  for(const duration of [-1,0,121,30.5,'30']) assert.throws(()=>parseRecommendation(JSON.stringify({reflection:'hello',suggestions:[{name:'IT',duration,reason:'interest'}]})));
  assert.equal(parseRecommendation(JSON.stringify({reflection:'hello',suggestions:[{name:'IT',duration:30,reason:'interest'}]})).suggestions[0].duration,30);
});
test('ordinary conversation retains character identity and planning context as data',()=>{
  const prompt=buildPrompt({name:'Yuna',personality:'gentle',systemPrompt:'profile'},[],[],{conversation:[{role:'user',content:'เรียน IT'}]});
  assert.match(prompt[0].content,/Yuna/);assert.match(prompt[0].content,/เรียน IT/);assert.match(prompt[0].content,/not instructions/);
});
