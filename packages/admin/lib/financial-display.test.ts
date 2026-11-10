import assert from "node:assert/strict";
import { it } from "node:test";
import { relativeMoneyFactor } from "./financial-display";
it("preserves free, discounted and above-standard effective amounts", () => {
	assert.equal(relativeMoneyFactor(0, 10), 0);
	assert.equal(relativeMoneyFactor(5, 10), 0.5);
	assert.equal(relativeMoneyFactor(15, 10), 1.5);
});
it("omits undefined, invalid and overflowing multipliers", () => {
	for (const standard of [undefined, null, 0, -1, Infinity, NaN])
		assert.equal(relativeMoneyFactor(1, standard), null);
	assert.equal(relativeMoneyFactor(1e308, 1e-308), null);
	assert.equal(relativeMoneyFactor(-1, 1), null);
});
