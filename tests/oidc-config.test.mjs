import assert from "node:assert/strict";
import test from "node:test";
import { readOidcConfig } from "../src/lib/oidc/config.ts";

const FULL = {
	OIDC_ISSUER: "https://auth.example.com/realms/erp",
	OIDC_CLIENT_ID: "mailflare",
	OIDC_CLIENT_SECRET: "s3cret",
};

test("returns disabled when no OIDC variables are set", () => {
	assert.deepEqual(readOidcConfig({}), { status: "disabled" });
});

test("returns incomplete listing every missing required variable", () => {
	const result = readOidcConfig({ OIDC_ISSUER: FULL.OIDC_ISSUER });
	assert.equal(result.status, "incomplete");
	assert.deepEqual(result.missing, ["OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]);
});

test("treats blank strings as absent", () => {
	assert.deepEqual(readOidcConfig({ OIDC_ISSUER: "   " }), { status: "disabled" });
});

test("applies defaults when only required variables are set", () => {
	const result = readOidcConfig(FULL);
	assert.equal(result.status, "enabled");
	assert.equal(result.config.issuer, FULL.OIDC_ISSUER);
	assert.equal(result.config.scopes, "openid email profile");
	assert.equal(result.config.buttonLabel, "Sign in with SSO");
	assert.equal(result.config.redirectUri, null);
	assert.equal(result.config.autoProvision, false);
	assert.deepEqual(result.config.allowedEmailDomains, []);
	assert.equal(result.config.groupsClaim, null);
	assert.equal(result.config.requiredGroup, null);
	assert.equal(result.config.oidcOnly, false);
});

test("parses booleans from true and 1 case-insensitively", () => {
	for (const value of ["true", "TRUE", "1"]) {
		assert.equal(readOidcConfig({ ...FULL, OIDC_ONLY: value }).config.oidcOnly, true, value);
	}
	for (const value of ["false", "0", "yes", ""]) {
		assert.equal(readOidcConfig({ ...FULL, OIDC_ONLY: value }).config.oidcOnly, false, value);
	}
});

test("normalises the allowed email domain list", () => {
	const result = readOidcConfig({ ...FULL, OIDC_ALLOWED_EMAIL_DOMAINS: " Example.COM , ,aejuice.com " });
	assert.deepEqual(result.config.allowedEmailDomains, ["example.com", "aejuice.com"]);
});

test("ignores the required group unless the groups claim is configured", () => {
	const withoutClaim = readOidcConfig({ ...FULL, OIDC_REQUIRED_GROUP: "mail-users" });
	assert.equal(withoutClaim.status, "incomplete");
	assert.deepEqual(withoutClaim.missing, ["OIDC_GROUPS_CLAIM"]);

	const withClaim = readOidcConfig({ ...FULL, OIDC_GROUPS_CLAIM: "groups", OIDC_REQUIRED_GROUP: "mail-users" });
	assert.equal(withClaim.config.groupsClaim, "groups");
	assert.equal(withClaim.config.requiredGroup, "mail-users");
});

test("requires the groups claim when a required group is set", () => {
	const result = readOidcConfig({ ...FULL, OIDC_REQUIRED_GROUP: "mail-users" });
	assert.equal(result.status, "incomplete");
	assert.ok(result.missing.includes("OIDC_GROUPS_CLAIM"));
});

test("allows the groups claim on its own with no required group", () => {
	const result = readOidcConfig({ ...FULL, OIDC_GROUPS_CLAIM: "groups" });
	assert.equal(result.status, "enabled");
	assert.equal(result.config.groupsClaim, "groups");
	assert.equal(result.config.requiredGroup, null);
});

test("treats a blank required group as absent, not a misconfiguration", () => {
	const result = readOidcConfig({ ...FULL, OIDC_REQUIRED_GROUP: "   " });
	assert.equal(result.status, "enabled");
	assert.equal(result.config.requiredGroup, null);
});

test("strips a trailing slash from the issuer", () => {
	const result = readOidcConfig({ ...FULL, OIDC_ISSUER: "https://auth.example.com/realms/erp/" });
	assert.equal(result.config.issuer, "https://auth.example.com/realms/erp");
});
