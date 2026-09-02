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

test("branch 2: a verified email links to the existing account exactly once", async () => {
	const existing = { id: "u2", email: "user@example.com", disabled: false };
	const { store, calls } = makeStore({ usersByEmail: { "user@example.com": existing } });
	const result = await resolveOidcUser({ issuer: ISSUER, claims: claims(), policy: CLOSED_POLICY, store });
	assert.deepEqual(result, { ok: true, user: existing });
	assert.deepEqual(calls.linked, [{ userId: "u2", issuer: ISSUER, subject: "sub-1" }]);
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
		policy: { autoProvision: true, allowedEmailDomains: ["aejuice.com"], requiredGroup: null },
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
