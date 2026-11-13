import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { queryDashboardOverview } from './dashboard-overview';

const window = { startDate:'2026-11-02 00:00:00',endDate:'2026-11-03 00:00:00',previousStart:'2026-11-01 00:00:00',previousEnd:'2026-11-02 00:00:00' };
function fixture() {
 const db = new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE api_key_request_logs (created_at TEXT, status TEXT, latency_ms INTEGER, stream_duration_ms INTEGER, first_reasoning_token_ms INTEGER, first_token_ms INTEGER, charged_cost REAL, metered_cost REAL, standard_cost REAL, upstream_failover_count INTEGER, upstream_attempt_count INTEGER, provider_id TEXT, provider_name TEXT, user_id TEXT, error_message TEXT)`);
 const add = (values: Partial<Record<string,unknown>> = {}) => {
 const row = { created_at:'2026-11-02 01:00:00', status:'success', latency_ms:100, stream_duration_ms:50, first_reasoning_token_ms:null,first_token_ms:10,charged_cost:2,metered_cost:1,standard_cost:4,upstream_failover_count:0,upstream_attempt_count:1,provider_id:'p1',provider_name:'Provider',user_id:'u1',error_message:null,...values };
 db.prepare(`INSERT INTO api_key_request_logs (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row) as (string | number | null)[]);
 };
 const run = () => queryDashboardOverview(async(sql,binds) => db.prepare(sql).all(...binds) as Record<string,unknown>[],window);
 return { db, add, run };
}

test('nearest-rank P95 uses every successful sample and excludes failures and missing stream timing',async()=>{
 const f=fixture();try {
 for(let i=1;i<=20;i++) f.add({latency_ms:i*100,first_token_ms:i*10});
 f.add({status:'error',latency_ms:999999,first_token_ms:99999,error_message:'HTTP 504 timeout'});
 f.add({latency_ms:null,first_token_ms:9000,stream_duration_ms:null,upstream_failover_count:null,upstream_attempt_count:null});
 f.add({created_at:window.previousStart,latency_ms:300,first_reasoning_token_ms:5,first_token_ms:20});
 f.add({created_at:window.endDate,latency_ms:999999});
 const result=await f.run();
 assert.equal(result.current.requests,22);assert.equal(result.previous.requests,1);
 assert.equal(result.current.latencySamples,20);assert.equal(result.current.latencyP50,1000);assert.equal(result.current.latencyP95,1900);
 assert.equal(result.current.ttftSamples,20);assert.equal(result.current.ttftP95,190);assert.equal(result.previous.ttftP95,5);
 assert.equal(result.current.charged,44);assert.equal(result.current.metered,22);assert.equal(result.current.standard,88);assert.equal(result.current.errorCost,1);
 assert.equal(result.current.failoverSamples,21);
 }finally{f.db.close();}
});

test('error composition, status counts and provider ranks cover the period, not a recent sample',async()=>{
 const f=fixture();try{
 for(let i=0;i<12;i++)f.add({status:'error',provider_id:'p2',provider_name:'Broken',error_message:'HTTP 429 rate limited',upstream_failover_count:2,upstream_attempt_count:3});
 for(const message of ['HTTP 504 timeout','HTTP 401 invalid key','HTTP 502 bad gateway','HTTP 400 invalid request','unknown'])f.add({status:'error',error_message:message});
 f.add({status:'cancelled'});f.add({status:'incomplete'});
 const r=await f.run();assert.equal(r.current.errors,17);assert.equal(r.current.incomplete,1);assert.equal(r.current.cancelled,1);
 assert.equal(r.current.failoverRequests,12);assert.equal(r.current.failoverSamples,19);
 assert.equal(r.providers[0].id,'p2');assert.equal(r.providers[0].errors,12);assert.equal(r.providers[0].affectedUsers,1);
 assert.equal(r.errorCategories.reduce((n,v)=>n+v.count,0),17);
 assert.equal(r.errorCategories.find(v=>v.category==='rate_limit')?.count,12);
 assert.equal(r.errorCategories.length,6);
 }finally{f.db.close();}
});

test('empty and legacy windows preserve missing timing as null and zero amounts as zero',async()=>{
 const f=fixture();try{
 const empty=await f.run();assert.equal(empty.current.latencyP95,null);assert.equal(empty.current.requests,0);assert.deepEqual(empty.providers,[]);
 f.add({latency_ms:0,first_token_ms:0,upstream_failover_count:null,upstream_attempt_count:null,charged_cost:0,metered_cost:0,standard_cost:0});
 const r=await f.run();assert.equal(r.current.latencyP95,0);assert.equal(r.current.ttftP95,0);assert.equal(r.current.avgAttempts,null);assert.equal(r.current.failoverSamples,0);assert.equal(r.current.charged,0);
 }finally{f.db.close();}
});
