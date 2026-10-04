/**
 * The web client keeps its own copies of the schema utilities (it is built
 * separately from the extension). Guard against the copies drifting apart.
 * Run: node --test tests/shared-utils.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("utilities shared by extension and web client", () => {
    for (const file of ["migrate.js", "derive.js"]) {
        it(`${file} is identical in both`, () => {
            assert.equal(read(`web_client/src/utils/${file}`), read(`chrome_extension/utils/${file}`));
        });
    }
});
