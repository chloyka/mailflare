import assert from "node:assert/strict";
import test from "node:test";
import { base64UrlEncode, codeChallengeS256, randomUrlSafeToken, safeCompare } from "../src/lib/oidc/pkce.ts";

test("computes the S256 challenge from the RFC 7636 appendix B vector", async () => {
	const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
	assert.equal(await codeChallengeS256(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("base64url output has no padding or unsafe characters", () => {
	const encoded = base64UrlEncode(new Uint8Array([251, 255, 190, 0, 1, 2]));
	assert.doesNotMatch(encoded, /[+/=]/);
});

test("random tokens are url-safe and unique", () => {
	const first = randomUrlSafeToken();
	const second = randomUrlSafeToken();
	assert.match(first, /^[A-Za-z0-9_-]+$/);
	assert.notEqual(first, second);
	assert.ok(first.length >= 42, `expected at least 42 chars, got ${first.length}`);
});

test("safeCompare matches only identical strings", () => {
	assert.equal(safeCompare("abc", "abc"), true);
	assert.equal(safeCompare("abc", "abd"), false);
	assert.equal(safeCompare("abc", "abcd"), false);
	assert.equal(safeCompare("", ""), true);
});
