import assert from "node:assert/strict";
import test from "node:test";
import { parseUserinfo, resolveOidcUser } from "../src/lib/oidc/identity.ts";

const ISSUER = "https://auth.example.com/realms/erp";

function makeStore(seed = {}) {
	const identities = new Map(Object.entries(seed.identities ?? {}));
	const usersByEmail = new Map(Object.entries(seed.usersByEmail ?? {}));
	const calls = { linked: [], created: [] };
	return {
		calls,
		store: {
			async findUserByOidcIdentity(issuer, subject) {
				return identities.get(`${issuer}|${subject}`) ?? null;
			},
			async findUserByEmail(email) {
				return usersByEmail.get(email) ?? null;
			},
			async linkIdentity(userId, issuer, subject) {
				calls.linked.push({ userId, issuer, subject });
			},
			async createUser({ email, name }) {
				const user = { id: "new-user", email, disabled: false };
				calls.created.push({ email, name });
				return user;
			},
		},
	};
}

const OPEN_POLICY = { autoProvision: true, allowedEmailDomains: [], requiredGroup: null };
const CLOSED_POLICY = { autoProvision: false, allowedEmailDomains: [], requiredGroup: null };

function claims(overrides = {}) {
	return { subject: "sub-1", email: "user@example.com", emailVerified: true, name: "User", groups: [], ...overrides };
}

test("parseUserinfo normalises a string email_verified", () => {
	const parsed = parseUserinfo({ sub: "sub-1", email: "a@b.com", email_verified: "true" }, null);
	assert.equal(parsed.emailVerified, true);
	assert.equal(parseUserinfo({ sub: "s", email_verified: false }, null).emailVerified, false);
	assert.equal(parseUserinfo({ sub: "s", email_verified: "yes" }, null).emailVerified, false);
});

test("parseUserinfo lowercases the email and reads the configured groups claim", () => {
	const parsed = parseUserinfo({ sub: "s", email: "User@Example.COM", groups: ["a", "b"] }, "groups");
	assert.equal(parsed.email, "user@example.com");
	assert.deepEqual(parsed.groups, ["a", "b"]);
	assert.deepEqual(parseUserinfo({ sub: "s", groups: ["a"] }, null).groups, []);
	assert.deepEqual(parseUserinfo({ sub: "s", groups: "not-a-list" }, "groups").groups, []);
});

test("parseUserinfo throws when sub is absent", () => {
	assert.throws(() => parseUserinfo({ email: "a@b.com" }, null), /sub/);
});

test("parseUserinfo defaults emailVerified to false when the claim is absent", () => {
	const parsed = parseUserinfo({ sub: "s", email: "a@b.com" }, null);
	assert.equal(parsed.emailVerified, false);
});

test("parseUserinfo drops non-string entries from the groups claim", () => {
	const parsed = parseUserinfo({ sub: "s", groups: ["a", 1, null, {}, "b"] }, "groups");
	assert.deepEqual(parsed.groups, ["a", "b"]);
});

test("branch 1: an existing link wins and ignores the idp email", async () => {
	const linked = { id: "u1", email: "old@example.com", disabled: false };
	const { store, calls } = makeStore({ identities: { [`${ISSUER}|sub-1`]: linked } });
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: "changed@example.com" }),
		policy: CLOSED_POLICY,
		store,
	});
	assert.deepEqual(result, { ok: true, user: linked });
	assert.equal(calls.linked.length, 0);
	assert.equal(calls.created.length, 0);
});

test("an already-linked user not in the required group is refused, even though identification does not need it", async () => {
	const linked = { id: "u1", email: "user@example.com", disabled: false };
	const { store, calls } = makeStore({ identities: { [`${ISSUER}|sub-1`]: linked } });
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ groups: ["other"] }),
		policy: { autoProvision: false, allowedEmailDomains: [], requiredGroup: "mail-users" },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "group_missing" });
	assert.equal(calls.linked.length, 0);
});

test("an already-linked user whose LOCAL email domain is not allowed is refused, even if the claims email would pass", async () => {
	const linked = { id: "u1", email: "user@evilexample.com", disabled: false };
	const { store, calls } = makeStore({ identities: { [`${ISSUER}|sub-1`]: linked } });
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: "user@example.com" }),
		policy: { autoProvision: false, allowedEmailDomains: ["example.com"], requiredGroup: null },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "domain_not_allowed" });
	assert.equal(calls.linked.length, 0);
});

test("a configured domain filter fails closed when the local account has no usable email to check", async () => {
	const linked = { id: "u1", email: "", disabled: false };
	const { store, calls } = makeStore({ identities: { [`${ISSUER}|sub-1`]: linked } });
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: null }),
		policy: { autoProvision: false, allowedEmailDomains: ["example.com"], requiredGroup: null },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "domain_not_allowed" });
	assert.equal(calls.linked.length, 0);
});

test("an already-linked account is admitted when its local email domain is allowed, even though the unverified claims email is out of allowlist", async () => {
	const linked = { id: "u1", email: "contractor@example.com", disabled: false };
	const { store, calls } = makeStore({ identities: { [`${ISSUER}|sub-1`]: linked } });
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: "contractor@attacker.com" }),
		policy: { autoProvision: false, allowedEmailDomains: ["example.com"], requiredGroup: null },
		store,
	});
	assert.deepEqual(result, { ok: true, user: linked });
	assert.equal(calls.linked.length, 0);
});

test("the deprovisioning bypass: an already-linked account whose local email is outside the allowlist is refused even when the unverified claims email would pass", async () => {
	const linked = { id: "u1", email: "contractor@gmail.com", disabled: false };
	const { store, calls } = makeStore({ identities: { [`${ISSUER}|sub-1`]: linked } });
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: "contractor@example.com", emailVerified: false }),
		policy: { autoProvision: false, allowedEmailDomains: ["example.com"], requiredGroup: null },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "domain_not_allowed" });
	assert.equal(calls.linked.length, 0);
});

test("branch 2: a verified email links to the existing account exactly once", async () => {
	const existing = { id: "u2", email: "user@example.com", disabled: false };
	const { store, calls } = makeStore({ usersByEmail: { "user@example.com": existing } });
	const result = await resolveOidcUser({ issuer: ISSUER, claims: claims(), policy: CLOSED_POLICY, store });
	assert.deepEqual(result, { ok: true, user: existing });
	assert.deepEqual(calls.linked, [{ userId: "u2", issuer: ISSUER, subject: "sub-1" }]);
});

test("the link-by-email path refuses a user missing the required group, and links nothing", async () => {
	const existing = { id: "u2", email: "user@example.com", disabled: false };
	const { store, calls } = makeStore({ usersByEmail: { "user@example.com": existing } });
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ groups: ["other"] }),
		policy: { autoProvision: false, allowedEmailDomains: [], requiredGroup: "mail-users" },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "group_missing" });
	assert.equal(calls.linked.length, 0);
});

test("the link-by-email path refuses a disallowed domain, and links nothing", async () => {
	const existing = { id: "u2", email: "user@evilexample.com", disabled: false };
	const { store, calls } = makeStore({ usersByEmail: { "user@evilexample.com": existing } });
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: "user@evilexample.com" }),
		policy: { autoProvision: false, allowedEmailDomains: ["example.com"], requiredGroup: null },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "domain_not_allowed" });
	assert.equal(calls.linked.length, 0);
});

test("branch 3: an unverified email never links and never provisions", async () => {
	const existing = { id: "u2", email: "user@example.com", disabled: false };
	const { store, calls } = makeStore({ usersByEmail: { "user@example.com": existing } });
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ emailVerified: false }),
		policy: OPEN_POLICY,
		store,
	});
	assert.deepEqual(result, { ok: false, code: "email_unverified" });
	assert.equal(calls.linked.length, 0);
	assert.equal(calls.created.length, 0);
});

test("a provider that omits the email is rejected as no_account", async () => {
	const { store } = makeStore();
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: null }),
		policy: OPEN_POLICY,
		store,
	});
	assert.deepEqual(result, { ok: false, code: "no_account" });
});

test("a missing email is no_account even when emailVerified is also false — the email check comes first", async () => {
	const { store } = makeStore();
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: null, emailVerified: false }),
		policy: OPEN_POLICY,
		store,
	});
	assert.deepEqual(result, { ok: false, code: "no_account" });
});

test("an email with no @ is rejected as no_account, and multiple @ signs use the last one as the domain", async () => {
	const { store: noAtStore } = makeStore();
	const noAtResult = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: "noatsign" }),
		policy: OPEN_POLICY,
		store: noAtStore,
	});
	assert.deepEqual(noAtResult, { ok: false, code: "no_account" });

	const { store: multiAtStore, calls } = makeStore();
	const multiAtResult = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: "a@b@example.com", name: null }),
		policy: { autoProvision: true, allowedEmailDomains: ["example.com"], requiredGroup: null },
		store: multiAtStore,
	});
	assert.equal(multiAtResult.ok, true);
	assert.deepEqual(calls.created, [{ email: "a@b@example.com", name: "a" }]);
});

test("the domain allowlist is exact match, not a suffix match", async () => {
	const { store, calls } = makeStore();
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: "user@evilexample.com" }),
		policy: { autoProvision: true, allowedEmailDomains: ["example.com"], requiredGroup: null },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "domain_not_allowed" });
	assert.equal(calls.created.length, 0);
});

test("branch 4: provisioning disabled rejects an unknown user", async () => {
	const { store, calls } = makeStore();
	const result = await resolveOidcUser({ issuer: ISSUER, claims: claims(), policy: CLOSED_POLICY, store });
	assert.deepEqual(result, { ok: false, code: "no_account" });
	assert.equal(calls.created.length, 0);
});

test("branch 5: the domain filter rejects before creating anything", async () => {
	const { store, calls } = makeStore();
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims(),
		policy: { autoProvision: true, allowedEmailDomains: ["example.org"], requiredGroup: null },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "domain_not_allowed" });
	assert.equal(calls.created.length, 0);
});

test("branch 6: the required group rejects before creating anything", async () => {
	const { store, calls } = makeStore();
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ groups: ["other"] }),
		policy: { autoProvision: true, allowedEmailDomains: [], requiredGroup: "mail-users" },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "group_missing" });
	assert.equal(calls.created.length, 0);
});

test("the required group fails closed when the claims carry no group membership at all", async () => {
	const { store, calls } = makeStore();
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ groups: [] }),
		policy: { autoProvision: true, allowedEmailDomains: [], requiredGroup: "mail-users" },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "group_missing" });
	assert.equal(calls.created.length, 0);
});

test("the required group check is exact, not a substring or path match", async () => {
	const { store, calls } = makeStore();
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ groups: ["mail-users-alumni", "/mail-users"] }),
		policy: { autoProvision: true, allowedEmailDomains: [], requiredGroup: "mail-users" },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "group_missing" });
	assert.equal(calls.created.length, 0);
});

test("an email with an empty domain (user@) is rejected as domain_not_allowed when a domain filter is configured", async () => {
	const { store, calls } = makeStore();
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ email: "user@" }),
		policy: { autoProvision: true, allowedEmailDomains: ["example.com"], requiredGroup: null },
		store,
	});
	assert.deepEqual(result, { ok: false, code: "domain_not_allowed" });
	assert.equal(calls.created.length, 0);
});

test("branch 7: a permitted user is created and linked", async () => {
	const { store, calls } = makeStore();
	const result = await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ groups: ["mail-users"] }),
		policy: { autoProvision: true, allowedEmailDomains: ["example.com"], requiredGroup: "mail-users" },
		store,
	});
	assert.equal(result.ok, true);
	assert.equal(result.user.id, "new-user");
	assert.deepEqual(calls.created, [{ email: "user@example.com", name: "User" }]);
	assert.deepEqual(calls.linked, [{ userId: "new-user", issuer: ISSUER, subject: "sub-1" }]);
});

test("a disabled account is refused on both the linked and the newly linked path", async () => {
	const disabled = { id: "u1", email: "user@example.com", disabled: true };

	const linkedStore = makeStore({ identities: { [`${ISSUER}|sub-1`]: disabled } });
	assert.deepEqual(
		await resolveOidcUser({ issuer: ISSUER, claims: claims(), policy: CLOSED_POLICY, store: linkedStore.store }),
		{ ok: false, code: "account_disabled" },
	);

	const byEmailStore = makeStore({ usersByEmail: { "user@example.com": disabled } });
	assert.deepEqual(
		await resolveOidcUser({ issuer: ISSUER, claims: claims(), policy: CLOSED_POLICY, store: byEmailStore.store }),
		{ ok: false, code: "account_disabled" },
	);
});

test("a newly created user that comes back disabled is refused, not admitted", async () => {
	const identities = new Map();
	const usersByEmail = new Map();
	const calls = { linked: [], created: [] };
	const store = {
		async findUserByOidcIdentity(issuer, subject) {
			return identities.get(`${issuer}|${subject}`) ?? null;
		},
		async findUserByEmail(email) {
			return usersByEmail.get(email) ?? null;
		},
		async linkIdentity(userId, issuer, subject) {
			calls.linked.push({ userId, issuer, subject });
		},
		async createUser({ email, name }) {
			const user = { id: "new-user", email, disabled: true };
			calls.created.push({ email, name });
			return user;
		},
	};
	const result = await resolveOidcUser({ issuer: ISSUER, claims: claims(), policy: OPEN_POLICY, store });
	assert.deepEqual(result, { ok: false, code: "account_disabled" });
});

test("the display name falls back to the email local part", async () => {
	const { store, calls } = makeStore();
	await resolveOidcUser({
		issuer: ISSUER,
		claims: claims({ name: null }),
		policy: OPEN_POLICY,
		store,
	});
	assert.deepEqual(calls.created, [{ email: "user@example.com", name: "user" }]);
});
