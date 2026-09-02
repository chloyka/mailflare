export type OidcClaims = {
	subject: string;
	email: string | null;
	emailVerified: boolean;
	name: string | null;
	groups: string[];
};

export type StoredUser = {
	id: string;
	email: string;
	disabled: boolean;
};

export type IdentityStore = {
	findUserByOidcIdentity(issuer: string, subject: string): Promise<StoredUser | null>;
	findUserByEmail(email: string): Promise<StoredUser | null>;
	linkIdentity(userId: string, issuer: string, subject: string): Promise<void>;
	createUser(input: { email: string; name: string }): Promise<StoredUser>;
};

export type ProvisioningPolicy = {
	autoProvision: boolean;
	allowedEmailDomains: string[];
	requiredGroup: string | null;
};

export type OidcFailureCode =
	| "email_unverified"
	| "no_account"
	| "domain_not_allowed"
	| "group_missing"
	| "account_disabled";

export type ResolveResult = { ok: true; user: StoredUser } | { ok: false; code: OidcFailureCode };

function readString(raw: Record<string, unknown>, key: string): string | null {
	const value = raw[key];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseUserinfo(raw: Record<string, unknown>, groupsClaim: string | null): OidcClaims {
	const subject = readString(raw, "sub");
	if (!subject) throw new Error("OIDC userinfo response contained no sub claim");

	const verified = raw.email_verified;
	const rawGroups = groupsClaim ? raw[groupsClaim] : null;

	return {
		subject,
		email: readString(raw, "email")?.toLowerCase() ?? null,
		emailVerified: verified === true || verified === "true",
		name: readString(raw, "name"),
		groups: Array.isArray(rawGroups) ? rawGroups.filter((item): item is string => typeof item === "string") : [],
	};
}

export async function resolveOidcUser(input: {
	issuer: string;
	claims: OidcClaims;
	policy: ProvisioningPolicy;
	store: IdentityStore;
}): Promise<ResolveResult> {
	const { issuer, claims, policy, store } = input;

	const linked = await store.findUserByOidcIdentity(issuer, claims.subject);
	if (linked) {
		return linked.disabled ? { ok: false, code: "account_disabled" } : { ok: true, user: linked };
	}

	if (!claims.email) return { ok: false, code: "no_account" };
	if (!claims.emailVerified) return { ok: false, code: "email_unverified" };

	const existing = await store.findUserByEmail(claims.email);
	if (existing) {
		if (existing.disabled) return { ok: false, code: "account_disabled" };
		await store.linkIdentity(existing.id, issuer, claims.subject);
		return { ok: true, user: existing };
	}

	if (!policy.autoProvision) return { ok: false, code: "no_account" };

	const domain = claims.email.slice(claims.email.lastIndexOf("@") + 1);
	if (policy.allowedEmailDomains.length && !policy.allowedEmailDomains.includes(domain)) {
		return { ok: false, code: "domain_not_allowed" };
	}

	if (policy.requiredGroup && !claims.groups.includes(policy.requiredGroup)) {
		return { ok: false, code: "group_missing" };
	}

	const created = await store.createUser({
		email: claims.email,
		name: claims.name ?? claims.email.slice(0, claims.email.indexOf("@")),
	});
	await store.linkIdentity(created.id, issuer, claims.subject);
	return { ok: true, user: created };
}
