import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardOverviewWindow } from './dashboard-window';
import { dashboardPeriodChange } from '../../../components/dashboard/dashboard-comparison';

test('today compares yesterday at equal progress in the business timezone',()=>{
 const r=dashboardOverviewWindow('2026-11-12 16:00:00','2026-11-12 18:00:00','Asia/Shanghai','today',Date.parse('2026-11-12T18:00:00Z'));
 assert.equal(r.previousStart,'2026-11-11 16:00:00');assert.equal(r.previousEnd,'2026-11-11 18:00:01');
});
test('historical windows use an adjacent equal half-open interval with no overlapping boundary',()=>{
 const r=dashboardOverviewWindow('2026-11-02 00:00:00','2026-11-02 23:59:59','UTC','custom');
 assert.equal(r.endDate,'2026-11-03 00:00:00');assert.equal(r.previousEnd,r.startDate);assert.equal(r.previousStart,'2026-11-01 00:00:00');
});
test('future range ends are clipped and zero baselines never produce infinity',()=>{
 const r=dashboardOverviewWindow('2026-11-02 00:00:00','2026-11-04 00:00:00','UTC','custom',Date.parse('2026-11-02T12:00:00Z'));
 assert.equal(r.endDate,'2026-11-02 12:00:01');
 assert.equal(dashboardPeriodChange(10,0,'count')?.unit,'new');assert.equal(dashboardPeriodChange(0,0,'count'),null);
 assert.equal(dashboardPeriodChange(null,10,'latency'),null);assert.equal(dashboardPeriodChange(95,90,'rate')?.value,5);
 assert.equal(dashboardPeriodChange(100,50,'money')?.value,100);
 assert.equal(dashboardPeriodChange(100000,100001,'latency'),null);
});
