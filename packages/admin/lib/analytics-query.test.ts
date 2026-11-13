import test from 'node:test';
import assert from "node:assert/strict";
import { it } from "node:test";
import { analyticsRangeFromSearch } from "./analytics-query";
it("restores explicit time bounds from dashboard and log navigation", () => {
	const q =
		"?start_date=2026-11-01+00%3A00%3A00&end_date=2026-11-08+00%3A00%3A00&range=7d";
	assert.deepEqual(analyticsRangeFromSearch(q), {
		preset: "7d",
		start_date: "2026-11-01 00:00:00",
		end_date: "2026-11-08 00:00:00",
	});
});
it("does not accept incomplete, invalid or reversed analytics windows", () => {
	for (const q of [
		"",
		"?start_date=x&end_date=y",
		"?start_date=2026-11-08&end_date=2026-11-01",
		"?start_date=2026-11-01",
		"?start_date=&end_date=",
	])
		assert.equal(analyticsRangeFromSearch(q), null);
});

// An explicit fixed window must not turn into an advancing rolling preset on drill-down.
test('explicit custom windows remain fixed even when their duration matches a rolling preset', () => {
 const end = new Date().toISOString().slice(0,19).replace('T',' ');
 const start = new Date(Date.now()-14*86400000).toISOString().slice(0,19).replace('T',' ');
 const restored=analyticsRangeFromSearch(new URLSearchParams({start_date:start,end_date:end,range:'custom'}).toString());
 assert.equal(restored?.preset,'custom');assert.equal(restored?.start_date,start);assert.equal(restored?.end_date,end);
});
