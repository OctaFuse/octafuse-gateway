import assert from "node:assert/strict";
import { it } from "node:test";
import { customMaintenanceMinutes } from "./maintenance-input";
it("requires positive whole minutes consistent with the duration input", () => {
	for (const v of [
		"",
		" ",
		"0",
		"-1",
		"0.5",
		"1.5",
		"Infinity",
		"9007199254740992",
	])
		assert.equal(customMaintenanceMinutes(v), null);
	assert.equal(customMaintenanceMinutes("15"), 15);
	assert.equal(customMaintenanceMinutes(" 20 "), 20);
});
