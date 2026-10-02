import assert from "node:assert/strict";
import { refundCents } from "./src/refund.mjs";

assert.equal(refundCents(10.4), 10);
assert.equal(refundCents(10.5), 11);
console.log("ok 2/2");
