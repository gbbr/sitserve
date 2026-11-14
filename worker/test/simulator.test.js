import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulator, shiftCorpus, weekShift } from '../simulator.js';
import { fixture, rawCourses } from './helpers.js';
import { TYPES, placeMatches, placeByKey } from '../../web/shared/courses.js';
const request = (params={}) => new Request('https://www.dhamma.org/en-US/courses/do_search',{method:'POST',body:new URLSearchParams(Object.entries(params).flatMap(([k,v])=>(Array.isArray(v)?v:[v]).map(x=>[k,x])))});
async function query(sim,params={}){return (await sim.fetch(request({current_state:'OldStudents','course_type_constraint[]':'3',daterange:'2026-11-14 - 2028-12-31',...params}))).json();}
test('required constraint, fixed paging, page past last and truncation',async()=>{
  const sim=createSimulator({rows:rawCourses(150)});const p=await query(sim,{page:11,per_page:50,page_size:50});assert.equal(p.courses.length,10);assert.equal(p.page,10);assert.equal(p.pages,10);assert.equal(p.total_rows,150);assert.equal(p.pages_truncated,true);
  assert.equal((await query(sim,{'course_type_constraint[]':[]})).total_rows,0);assert.equal((await query(sim,{page:1})).courses[0].id,900000);
  const short=await query(createSimulator({rows:rawCourses(64)}),{page:50});assert.equal(short.page,7);assert.equal(short.pages_truncated,false);assert.equal(short.courses.length,4);
});
test('start lower bound AND end upper bound; empty results page is 1',async()=>{
  const rows=rawCourses(2);rows[0].course_end_date='2026-12-01';
  const p=await query(createSimulator({rows}),{daterange:'2026-11-15 - 2026-11-16'});assert.deepEqual(p.courses.map(c=>c.id),[900001]);
  const e=await query(createSimulator({rows}),{daterange:'2026-12-02 - 2026-12-03'});assert.equal(e.total_rows,0);assert.equal(e.page,1);assert.equal(e.pages,1);
});
test('saved params shape excludes daterange, page and type constraint; mode/gender do not filter',async()=>{
  const sim=createSimulator({rows:rawCourses(20)});
  const p=await query(sim,{page:2,current_state:'NewStudents','genders[]':'Male'});
  assert.deepEqual(p.saved_search_params,{current_state:'NewStudents',genders:['Male']});assert.equal(p.total_rows,20);
});
for(const entry of fixture('manifest.json').files.filter(f=>!f.file.includes('d_base1'))) test(`recorded probe semantics: ${entry.file}`,async()=>{
  const recorded=fixture(entry.file),sim=createSimulator({rows:recorded.courses});
  const params={'course_type_constraint[]':entry.request.course_type_constraint.map(String),daterange:'2000-01-01 - 2040-12-31'};
  if(entry.request.regions)params['regions[]']=entry.request.regions;
  if(entry.request.languages)params['languages[]']=entry.request.languages;
  const p=await query(sim,params);
  assert.deepEqual(p.courses.map(c=>c.id).sort(),recorded.courses.map(c=>c.id).sort());
  assert.equal(typeof p.pages_truncated,typeof recorded.pages_truncated);assert.deepEqual(Object.keys(p).sort(),Object.keys(recorded).sort());
});
test('OR region/state/location/venue matching uses the shared metadata',async()=>{
  const sim=createSimulator();
  for(const key of ['region_402','state_3951','location_1542','sublocation_2156']) {
    const p=await query(sim,{'course_type_constraint[]':TYPES.map(t=>String(t[3])),'regions[]':key,daterange:'2000-01-01 - 2040-12-31'});assert.ok(p.courses.length,key);
    assert.ok(p.courses.every(c=>placeMatches({loc:{id:c.location.id,subId:c.location.sub_location_id,state:c.location.state,country:c.location.country}},placeByKey.get(key))));
  }
  const a=await query(sim,{'regions[]':'location_1542'}),b=await query(sim,{'regions[]':'location_1442'}),both=await query(sim,{'regions[]':['location_1542','location_1442']});assert.equal(both.total_rows,a.total_rows+b.total_rows);
});
test('language ISO code maps to an instruction-language name',async()=>{
  const rows=rawCourses(2);rows[0].course_instruction_languages=['English'];rows[1].course_instruction_languages=['French'];
  assert.equal((await query(createSimulator({rows}),{'languages[]':'en'})).courses[0].id,900000);
  assert.equal((await query(createSimulator({rows}),{'languages[]':'English'})).total_rows,0);
});
test('whole-week shift keeps weekdays and moves enrollment and timestamps together',()=>{
  const rows=rawCourses(1),shifted=shiftCorpus(rows,weekShift('2026-11-28'));assert.equal(weekShift('2026-11-28'),14);
  assert.equal(shifted[0].course_start_date,'2026-11-29');assert.equal(shifted[0].enrollment_open_date,'2026-01-15');assert.equal(rows[0].course_start_date,'2026-11-15');
});
for(const fault of ['429','503','html','malformed'])test(`simulator fault ${fault}`,async()=>{
  const r=await createSimulator({env:{SIMULATOR_FAULT:fault}}).fetch(request());
  if(/^\d/.test(fault))assert.equal(r.status,+fault);else if(fault==='html')assert.equal(r.headers.get('Content-Type'),'text/html');else await assert.rejects(r.json());
});
test('probe facts establish fixed page size, clamping, state independence and filter acceptance',()=>{
  const facts=fixture('probe-facts.json');
  for(const key of ['pp.json','ps.json'])assert.deepEqual(facts[key].ids,facts['base.json'].ids);
  assert.equal(facts['p11.json'].page,10);assert.equal(facts['p11.json'].pages,10);assert.equal(facts['p11.json'].total_rows,facts['base.json'].total_rows);
  assert.deepEqual(facts['t_new.json'].ids,facts['t_old.json'].ids);assert.equal(facts['t_new.json'].total_rows,facts['t_old.json'].total_rows);
  assert.deepEqual(facts['lang.json'].accepted.languages,['en']);assert.deepEqual(facts['am.json'].accepted.regions,['region_402']);
  assert.equal(facts['f_win.json'].total_rows,64);assert.equal(facts['f_win.json'].pages,7);assert.equal(facts['f_win.json'].pages_truncated,false);
  for(const key of Object.keys(facts).filter(k=>/^[de]_/.test(k)))assert.equal(facts[key].total_rows,0);
});
