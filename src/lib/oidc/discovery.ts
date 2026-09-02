export type OidcEndpoints = {
	issuer: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	userinfoEndpoint: string;
	tokenEndpointAuthMethods: string[];
};

const cache = new Map<string, OidcEndpoints>();

export function clearDiscoveryCache(): void {
	cache.clear();
}

function requireString(document: Record<string, unknown>, key: string): string {
	const value = document[key];
	if (typeof value !== "string" || !value) {
		throw new Error(`OIDC discovery document is missing ${key}`);
	}
	return value;
}

export async function discoverEndpoints(issuer: string, fetchImpl: typeof fetch = fetch): Promise<OidcEndpoints> {
	const normalized = issuer.replace(/\/+$/, "");
	const cached = cache.get(normalized);
	if (cached) return cached;

	const response = await fetchImpl(`${normalized}/.well-known/openid-configuration`);
	if (!response.ok) {
		throw new Error(`OIDC discovery failed with status ${response.status}`);
	}

	const document = (await response.json()) as Record<string, unknown>;
	const methods = document.token_endpoint_auth_methods_supported;
	const endpoints: OidcEndpoints = {
		issuer: requireString(document, "issuer"),
		authorizationEndpoint: requireString(document, "authorization_endpoint"),
		tokenEndpoint: requireString(document, "token_endpoint"),
		userinfoEndpoint: requireString(document, "userinfo_endpoint"),
		tokenEndpointAuthMethods: Array.isArray(methods) && methods.length
			? methods.map(String)
			: ["client_secret_basic"],
	};

	cache.set(normalized, endpoints);
	return endpoints;
}
