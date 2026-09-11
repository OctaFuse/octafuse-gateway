import assert from "node:assert/strict";
import test from "node:test";
import {
	customDomainRoutes,
	parseCustomDomains,
	primaryCustomDomain,
	collectProxyRuntimeVars,
} from "./gen-wrangler.mjs";

test("parseCustomDomains splits comma-separated hosts", () => {
	assert.deepEqual(parseCustomDomains("a.example.com,b.example.com"), [
		"a.example.com",
		"b.example.com",
	]);
});

test("parseCustomDomains trims whitespace and drops empty tokens", () => {
	assert.deepEqual(
		parseCustomDomains(" a.example.com , , b.example.com "),
		["a.example.com", "b.example.com"],
	);
});

test("parseCustomDomains de-dupes case-insensitively and keeps first spelling", () => {
	assert.deepEqual(
		parseCustomDomains("Api.example.com,api.example.com,API.example.com"),
		["Api.example.com"],
	);
});

test("parseCustomDomains treats empty or non-string as no hosts", () => {
	assert.deepEqual(parseCustomDomains(""), []);
	assert.deepEqual(parseCustomDomains("   "), []);
	assert.deepEqual(parseCustomDomains(" , , "), []);
	assert.deepEqual(parseCustomDomains(undefined), []);
});

test("primaryCustomDomain is the first parsed host", () => {
	assert.equal(primaryCustomDomain("a.example.com,b.example.com"), "a.example.com");
	assert.equal(primaryCustomDomain(""), "");
});

test("customDomainRoutes returns undefined when empty", () => {
	assert.equal(customDomainRoutes(""), undefined);
	assert.equal(customDomainRoutes("  ,  "), undefined);
	assert.equal(customDomainRoutes(undefined), undefined);
});

test("customDomainRoutes emits one custom_domain route per host", () => {
	assert.deepEqual(customDomainRoutes("a.example.com, b.example.com"), [
		{ pattern: "a.example.com", custom_domain: true },
		{ pattern: "b.example.com", custom_domain: true },
	]);
});

test("customDomainRoutes still accepts a single hostname", () => {
	assert.deepEqual(customDomainRoutes("api.example.com"), [
		{ pattern: "api.example.com", custom_domain: true },
	]);
});

test("collectProxyRuntimeVars omits empty keys", () => {
	assert.equal(collectProxyRuntimeVars({}), undefined);
	assert.equal(
		collectProxyRuntimeVars({ STREAM_IDLE_TIMEOUT_MS: "  " }),
		undefined,
	);
});

test("collectProxyRuntimeVars keeps trimmed positive overrides", () => {
	assert.deepEqual(
		collectProxyRuntimeVars({
			STREAM_FIRST_CHUNK_TIMEOUT_MS: " 180000 ",
			STREAM_IDLE_TIMEOUT_MS: "80000",
			USAGE_SAFETY_TIMEOUT_MS: "",
			UNRELATED: "1",
		}),
		{
			STREAM_FIRST_CHUNK_TIMEOUT_MS: "180000",
			STREAM_IDLE_TIMEOUT_MS: "80000",
		},
	);
});
