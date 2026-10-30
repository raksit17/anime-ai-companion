import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, type Session } from '../src/planner/engine';
import { isRecommendationRequest, recommendNext } from '../src/planner/next-recommendation';
const now = Date.parse('2026-10-30T13:00:00+07:00');
const session = (overrides: Partial<Session> = {}): Session => ({id:'a', name:'ฝึก IT', date:'2026-10-30', start:660, duration:30, status:'done', fixed:false, reminder:10,...overrides});
test('screenshot regression: never recommends completed or expired jobs from yesterday', () => {
  const s = initial();
  s.sessions = [session(),session({id:'b',date:'2026-10-29',status:'planned'})];
  const before = structuredClone(s);
  const r = recommendNext(s,'2026-10-29','แนะนำ กิจกรรมต่อไปให้ฉันที',now);
  assert.match(r.reply,/2026-10-30/);
  assert.doesNotMatch(r.reply,/11:00|ฝึก IT/);
  assert.deepEqual(s,before);
});
test('next scheduled activity uses real time and ignores done/skipped/deferred', () => {
  const s=initial();
  s.sessions=[session(),session({id:'b',name:'Coding',start:900,status:'planned'}),session({id:'c',name:'skip',start:840,status:'skipped'})];
  assert.match(recommendNext(s,'2026-10-30','แนะนำกิจกรรมต่อไป',now).reply,/Coding เวลา 15:00/);
});
test('current activity takes precedence without claiming the user actually started',()=>{
  const s=initial(); s.sessions=[session({start:750,duration:60,status:'planned'})];
  assert.match(recommendNext(s,'2026-10-30','ทำอะไรต่อ',now).reply,/ถ้ายังทำอยู่/);
});
test('goal alternatives respect capacity, breaks, low energy, and never mutate',()=>{
  const s=initial();
  s.goals=[{id:'g',name:'เรียนภาษา',days:[5],duration:60,preferred:840,priority:2,restDays:0,reminder:10,flexible:true}];
  s.sessions=[session({id:'fixed',name:'นัด',start:720,duration:60,status:'done',fixed:true})];
  const before=structuredClone(s);
  const r=recommendNext(s,'2026-10-30','แนะนำอะไรเบา ๆ',now);
  assert.equal(r.followUps.length,1);
  assert.match(r.followUps[0].prompt,/นาน 20 นาที/);
  assert.doesNotMatch(r.followUps[0].prompt,/เวลา 13:00/);
  assert.deepEqual(s,before);
  s.settings.maxMinutes=10;
  assert.equal(recommendNext(s,'2026-10-30','แนะนำ',now).followUps.length,0);
});
test('suppressed and completed goals cannot be recommended again',()=>{
  const s=initial();
  s.goals=[{id:'g',name:'ฝึก IT',days:[5],duration:30,preferred:900,priority:2,restDays:0,reminder:10,flexible:true}];
  s.sessions=[session()];
  assert.equal(recommendNext(s,'2026-10-30','แนะนำ',now).followUps.length,0);
  s.sessions=[];s.suppressedOccurrences={g:['2026-10-30']};
  assert.equal(recommendNext(s,'2026-10-30','แนะนำ',now).followUps.length,0);
});
test('mutation requests stay with normal command validation',()=>{
  assert.equal(isRecommendationRequest('แนะนำกิจกรรมต่อไป'),true);
  assert.equal(isRecommendationRequest('แนะนำแล้วเพิ่มงาน Coding'),false);
  assert.equal(isRecommendationRequest('เลื่อนงานที่แนะนำ'),false);
});
