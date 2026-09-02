import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthorizationUrl, exchangeAuthorizationCode, fetchUserinfo } from "../src/lib/oidc/client.ts";

const ENDPOINTS = {
	issuer: "https://auth.example.com/realms/erp",
	authorizationEndpoint: "https://auth.example.com/auth",
	tokenEndpoint: "https://auth.example.com/token",
	userinfoEndpoint: "https://auth.example.com/userinfo",
	tokenEndpointAuthMethods: ["client_secret_basic"],
};

const CONFIG = {
	issuer: ENDPOINTS.issuer,
	clientId: "mailflare",
	clientSecret: "s3cret",
	scopes: "openid email profile",
	redirectUri: null,
	buttonLabel: "Sign in with SSO",
	autoProvision: false,
	allowedEmailDomains: [],
	groupsClaim: null,
	requiredGroup: null,
	oidcOnly: false,
};

test("authorization url carries every required parameter", () => {
	const url = new URL(
		buildAuthorizationUrl({
			endpoints: ENDPOINTS,
			config: CONFIG,
			redirectUri: "https://mail.example.com/api/auth/oidc/callback",
			state: "state-value",
			codeChallenge: "challenge-value",
		}),
	);

	assert.equal(url.origin + url.pathname, "https://auth.example.com/auth");
	assert.equal(url.searchParams.get("response_type"), "code");
	assert.equal(url.searchParams.get("client_id"), "mailflare");
	assert.equal(url.searchParams.get("redirect_uri"), "https://mail.example.com/api/auth/oidc/callback");
	assert.equal(url.searchParams.get("scope"), "openid email profile");
	assert.equal(url.searchParams.get("state"), "state-value");
	assert.equal(url.searchParams.get("code_challenge"), "challenge-value");
	assert.equal(url.searchParams.get("code_challenge_method"), "S256");
	assert.equal(url.searchParams.get("client_secret"), null);
});

test("code exchange posts the verifier and authenticates with basic auth", async () => {
	let captured;
	const fetchImpl = async (url, init) => {
		captured = { url: String(url), init };
		return Response.json({ access_token: "at-123", token_type: "Bearer" });
	};

	const token = await exchangeAuthorizationCode({
		endpoints: ENDPOINTS,
		config: CONFIG,
		redirectUri: "https://mail.example.com/api/auth/oidc/callback",
		code: "auth-code",
		codeVerifier: "verifier-value",
		fetchImpl,
	});

	assert.equal(token, "at-123");
	assert.equal(captured.url, "https://auth.example.com/token");
	assert.equal(captured.init.method, "POST");
	assert.equal(
		captured.init.headers.Authorization,
		`Basic ${btoa("mailflare:s3cret")}`,
	);
	const body = new URLSearchParams(captured.init.body);
	assert.equal(body.get("grant_type"), "authorization_code");
	assert.equal(body.get("code"), "auth-code");
	assert.equal(body.get("code_verifier"), "verifier-value");
	assert.equal(body.get("redirect_uri"), "https://mail.example.com/api/auth/oidc/callback");
	assert.equal(body.get("client_secret"), null);
});

test("code exchange falls back to client_secret_post when basic is unsupported", async () => {
	let captured;
	const fetchImpl = async (url, init) => {
		captured = init;
		return Response.json({ access_token: "at-123" });
	};

	await exchangeAuthorizationCode({
		endpoints: { ...ENDPOINTS, tokenEndpointAuthMethods: ["client_secret_post"] },
		config: CONFIG,
		redirectUri: "https://mail.example.com/api/auth/oidc/callback",
		code: "auth-code",
		codeVerifier: "verifier-value",
		fetchImpl,
	});

	assert.equal(captured.headers.Authorization, undefined);
	const body = new URLSearchParams(captured.body);
	assert.equal(body.get("client_id"), "mailflare");
	assert.equal(body.get("client_secret"), "s3cret");
});

test("code exchange throws when the provider rejects the request", async () => {
	const fetchImpl = async () => new Response("invalid_grant", { status: 400 });
	await assert.rejects(
		() =>
			exchangeAuthorizationCode({
				endpoints: ENDPOINTS,
				config: CONFIG,
				redirectUri: "https://mail.example.com/api/auth/oidc/callback",
				code: "auth-code",
				codeVerifier: "verifier-value",
				fetchImpl,
			}),
		/400/,
	);
});

test("code exchange throws when the response carries no access token", async () => {
	const fetchImpl = async () => Response.json({ token_type: "Bearer" });
	await assert.rejects(
		() =>
			exchangeAuthorizationCode({
				endpoints: ENDPOINTS,
				config: CONFIG,
				redirectUri: "https://mail.example.com/api/auth/oidc/callback",
				code: "auth-code",
				codeVerifier: "verifier-value",
				fetchImpl,
			}),
		/access_token/,
	);
});

test("userinfo is requested as a bearer token", async () => {
	let captured;
	const fetchImpl = async (url, init) => {
		captured = { url: String(url), init };
		return Response.json({ sub: "user-1", email: "a@example.com" });
	};

	const claims = await fetchUserinfo({ endpoints: ENDPOINTS, accessToken: "at-123", fetchImpl });

	assert.equal(captured.url, "https://auth.example.com/userinfo");
	assert.equal(captured.init.headers.Authorization, "Bearer at-123");
	assert.equal(claims.sub, "user-1");
});

test("userinfo throws on a non-2xx response", async () => {
	const fetchImpl = async () => new Response("nope", { status: 401 });
	await assert.rejects(
		() => fetchUserinfo({ endpoints: ENDPOINTS, accessToken: "at-123", fetchImpl }),
		/401/,
	);
});
