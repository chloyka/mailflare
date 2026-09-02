// This module must have no runtime imports: tests/oidc-*.test.mjs load it directly via
// Node's type-stripping, which cannot resolve the "@/*" path alias. Use `import type`
// only, and pass anything else in as a parameter.

export type OidcConfig = {
	issuer: string;
	clientId: string;
	clientSecret: string;
	scopes: string;
	redirectUri: string | null;
	buttonLabel: string;
	autoProvision: boolean;
	allowedEmailDomains: string[];
	groupsClaim: string | null;
	requiredGroup: string | null;
	oidcOnly: boolean;
};

export type OidcConfigResult =
	| { status: "disabled" }
	| { status: "incomplete"; missing: string[] }
	| { status: "enabled"; config: OidcConfig };

const REQUIRED_KEYS = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"] as const;

function readString(env: Record<string, unknown>, key: string): string | null {
	const value = env[key];
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
}

function readBoolean(env: Record<string, unknown>, key: string): boolean {
	const value = readString(env, key)?.toLowerCase();
	return value === "true" || value === "1";
}

function readList(env: Record<string, unknown>, key: string): string[] {
	const value = readString(env, key);
	if (!value) return [];
	return value
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
}

export function readOidcConfig(env: Record<string, unknown>): OidcConfigResult {
	const present = REQUIRED_KEYS.filter((key) => readString(env, key) !== null);
	if (present.length === 0) return { status: "disabled" };
	if (present.length < REQUIRED_KEYS.length) {
		return { status: "incomplete", missing: REQUIRED_KEYS.filter((key) => readString(env, key) === null) };
	}

	const groupsClaim = readString(env, "OIDC_GROUPS_CLAIM");
	const requiredGroup = readString(env, "OIDC_REQUIRED_GROUP");
	if (requiredGroup && !groupsClaim) {
		return { status: "incomplete", missing: ["OIDC_GROUPS_CLAIM"] };
	}

	return {
		status: "enabled",
		config: {
			issuer: readString(env, "OIDC_ISSUER")!.replace(/\/+$/, ""),
			clientId: readString(env, "OIDC_CLIENT_ID")!,
			clientSecret: readString(env, "OIDC_CLIENT_SECRET")!,
			scopes: readString(env, "OIDC_SCOPES") ?? "openid email profile",
			redirectUri: readString(env, "OIDC_REDIRECT_URI"),
			buttonLabel: readString(env, "OIDC_BUTTON_LABEL") ?? "Sign in with SSO",
			autoProvision: readBoolean(env, "OIDC_AUTO_PROVISION"),
			allowedEmailDomains: readList(env, "OIDC_ALLOWED_EMAIL_DOMAINS"),
			groupsClaim,
			requiredGroup,
			oidcOnly: readBoolean(env, "OIDC_ONLY"),
		},
	};
}
