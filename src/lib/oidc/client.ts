// This module must have no runtime imports: tests/oidc-*.test.mjs load it directly via
// Node's type-stripping, which cannot resolve the "@/*" path alias. Use `import type`
// only, and pass anything else in as a parameter.

import type { OidcConfig } from "./config";
import type { OidcEndpoints } from "./discovery";

export function buildAuthorizationUrl(input: {
	endpoints: OidcEndpoints;
	config: OidcConfig;
	redirectUri: string;
	state: string;
	codeChallenge: string;
}): string {
	const url = new URL(input.endpoints.authorizationEndpoint);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", input.config.clientId);
	url.searchParams.set("redirect_uri", input.redirectUri);
	url.searchParams.set("scope", input.config.scopes);
	url.searchParams.set("state", input.state);
	url.searchParams.set("code_challenge", input.codeChallenge);
	url.searchParams.set("code_challenge_method", "S256");
	return url.toString();
}

export async function exchangeAuthorizationCode(input: {
	endpoints: OidcEndpoints;
	config: OidcConfig;
	redirectUri: string;
	code: string;
	codeVerifier: string;
	fetchImpl?: typeof fetch;
}): Promise<string> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const useBasic = input.endpoints.tokenEndpointAuthMethods.includes("client_secret_basic");

	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code: input.code,
		redirect_uri: input.redirectUri,
		code_verifier: input.codeVerifier,
		client_id: input.config.clientId,
	});
	const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };

	if (useBasic) {
		headers.Authorization = `Basic ${btoa(`${input.config.clientId}:${input.config.clientSecret}`)}`;
	} else {
		body.set("client_secret", input.config.clientSecret);
	}

	const response = await fetchImpl(input.endpoints.tokenEndpoint, {
		method: "POST",
		headers,
		body: body.toString(),
	});
	if (!response.ok) {
		throw new Error(`OIDC token exchange failed with status ${response.status}`);
	}

	const payload = (await response.json()) as Record<string, unknown>;
	const accessToken = payload.access_token;
	if (typeof accessToken !== "string" || !accessToken) {
		throw new Error("OIDC token response contained no access_token");
	}
	return accessToken;
}

export async function fetchUserinfo(input: {
	endpoints: OidcEndpoints;
	accessToken: string;
	fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
	const fetchImpl = input.fetchImpl ?? fetch;
	const response = await fetchImpl(input.endpoints.userinfoEndpoint, {
		headers: { Authorization: `Bearer ${input.accessToken}` },
	});
	if (!response.ok) {
		throw new Error(`OIDC userinfo request failed with status ${response.status}`);
	}
	return (await response.json()) as Record<string, unknown>;
}
