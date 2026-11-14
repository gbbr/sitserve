import test from 'node:test';
import assert from 'node:assert/strict';
import { availability, lights, matches, filterDefaults, parseFilters, serializeFilters, KEYS, COVERS, TYPE, FILTER_TYPES, typeClass } from '../../web/shared/courses.js';
import { template, fixture } from './helpers.js';
const today = '2026-11-14', f = filterDefaults(today), course = { ...template, start: '2026-11-20', enroll: '2026-01-01' };
for (const [type, covers] of [[null, KEYS], ...Object.entries(COVERS)]) test(`status coverage ${type}`, () => {
  const s = { type, status: 'Open', color: 'Green' }; const cells = lights({ ...course, status: [s] });
  assert.deepEqual(Object.keys(cells).sort(), [...covers].sort());
});
test('specific statuses override broad statuses regardless of order; new-student columns', () => {
  const statuses = [{ type:'om',color:'Red' }, { type:null,color:'Green' }, { type:'m',color:'Yellow' }];
  const l = lights({ ...course, status: statuses }); assert.equal(l.OM.color,'Red'); assert.equal(l.NM.color,'Yellow'); assert.equal(l.OF.color,'Green');
  for (const type of TYPE.keys()) assert.equal('NM' in lights({ ...course, type, status:[{ type:null }] }), ['10-Day','10-DayExecutive'].includes(type));
});
const seen = new Map();
for (const entry of fixture('manifest.json').files) for (const c of fixture(entry.file).courses) for (const s of c.status) seen.set(s.status + '/' + s.color, s);
for (const [name, status] of seen) test(`availability observed: ${name}`, () => {
  const c = { ...course, status:[{ ...status, type: null }] };
  const got = availability(c, f, today);
  const expected = /cancelled|canceled|in progress/i.test(status.status) ? '' : /^applications accepted/i.test(status.status) ? 'soon' : ['Green','Yellow','Orange'].includes(status.color) ? 'open' : '';
  assert.equal(got, expected);
  if (['Yellow','Orange'].includes(status.color)) assert.equal(availability(c,{ ...f, wait:false },today),'');
});
test('As, wait lists, not open, cancellation and new-student restrictions', () => {
  const c = { ...course, status:[{ type:'om',status:'Open',color:'Green' }] };
  assert.equal(availability(c, { ...f, as:'NM' },today),''); assert.equal(availability(c, { ...f, as:'OM' },today),'open');
  assert.equal(availability({ ...c, enroll:'2026-12-01' },f,today),'soon');
  assert.equal(availability({ ...c, enroll:'2026-12-01' },{ ...f,soon:false },today),'');
  assert.equal(availability({ ...c, type:'20-DayOSC',enroll:'2026-12-01' },{ ...f,as:'NF' },today),'');
  assert.equal(availability({ ...c,status:[{ status:'CANCELLED',color:'Green',type:null }],enroll:'2026-12-01' },f,today),'');
  for(const color of ['Yellow','Orange']) {
    assert.equal(availability({ ...c,status:[{ type:'ms',status:'Wait List',color }] },{ ...f,as:'SM' },today),'open');
    assert.equal(availability({ ...c,status:[{ type:'ms',status:'Wait List',color }] },{ ...f,as:'SF' },today),'');
  }
});
test('shared matches rechecks language, places, type and centers', () => {
  const c = { ...course, langs:['English'],loc:{ ...course.loc,id:1542,state:'Massachusetts',country:'United States',subId:2156,center:true } };
  for(const where of ['region_402','location_1542','sublocation_2156','state_3930']) {
    if(where==='state_3930') continue;
    assert.equal(matches(c,{ ...f,where }),true,where);
  }
  assert.equal(matches(c,{ ...f,where:'location_1442' }),false);
  assert.equal(matches(c,{ ...f,where:'location_1442,region_402' }),true);
  assert.equal(matches(c,{ ...f,lang:'en' }),true); assert.equal(matches(c,{ ...f,lang:'fr' }),false);
  assert.equal(matches(c,{ ...f,types:'20D' }),false); assert.equal(matches(c,{ ...f,from:'2027-01-01' }),false);
  assert.equal(matches({ ...c,loc:{ ...c.loc,center:false } },{ ...f,centers:true }),false);
});
test('fragment and query round trips; legacy language and gratitude; unknown places removed', () => {
  const p = parseFilters('#where=unknown_1,location_1542,location_1542&types=14D,TSC,STP&lang=English&as=SF&wait=0&soon=0&centers=1&from=2026-12-01',{ today });
  assert.equal(p.where,'location_1542'); assert.equal(p.types,'STP,14D/TSC'); assert.equal(p.lang,'en');
  assert.deepEqual(parseFilters('?' + serializeFilters(p,{ today }),{ today }),p);
  assert.deepEqual(parseFilters(serializeFilters(p,{ today, includeDefaults:true }),{ today:'2027-01-01' }),p);
  assert.equal(parseFilters('types=BAD&as=wat&from=bad&lang=unknown',{ today }).from,today);
});
for (const query of ['from=2026-02-30','as=BAD','types=Other','wait=true','lang=ZZ','bad=1','as=OM&as=NM']) test(`invalid API filters: ${query}`, () => assert.throws(() => parseFilters(query,{ today,strict:true })));
test('course chip groups and order are stable', () => {
  assert.deepEqual(FILTER_TYPES.map(([,c])=>c),['3D','10D','10D OS','EXEC','STP','14D/TSC','10D SPCL','20D','30D','45D','60D']);
  assert.equal(typeClass('TSC'),'special'); assert.equal(typeClass('60-DayOSC'),'long');
});
