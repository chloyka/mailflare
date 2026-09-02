import assert from "node:assert/strict";
import test from "node:test";
import { clearDiscoveryCache, discoverEndpoints } from "../src/lib/oidc/discovery.ts";

const DOCUMENT = {
	issuer: "https://auth.example.com/realms/erp",
	authorization_endpoint: "https://auth.example.com/realms/erp/protocol/openid-connect/auth",
	token_endpoint: "https://auth.example.com/realms/erp/protocol/openid-connect/token",
	userinfo_endpoint: "https://auth.example.com/realms/erp/protocol/openid-connect/userinfo",
	token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
};

function stubFetch(document = DOCUMENT, status = 200) {
	const calls = [];
	const impl = async (url) => {
		calls.push(String(url));
		return new Response(JSON.stringify(document), { status, headers: { "content-type": "application/json" } });
	};
	return { impl, calls };
}

test("requests the well-known document and maps every endpoint", async (t) => {
	t.beforeEach(clearDiscoveryCache);
	clearDiscoveryCache();
	const { impl, calls } = stubFetch();
	const endpoints = await discoverEndpoints("https://auth.example.com/realms/erp", impl);

	assert.equal(calls[0], "https://auth.example.com/realms/erp/.well-known/openid-configuration");
	assert.equal(endpoints.issuer, DOCUMENT.issuer);
	assert.equal(endpoints.authorizationEndpoint, DOCUMENT.authorization_endpoint);
	assert.equal(endpoints.tokenEndpoint, DOCUMENT.token_endpoint);
	assert.equal(endpoints.userinfoEndpoint, DOCUMENT.userinfo_endpoint);
	assert.deepEqual(endpoints.tokenEndpointAuthMethods, ["client_secret_basic", "client_secret_post"]);
});

test("caches the document per issuer", async () => {
	clearDiscoveryCache();
	const { impl, calls } = stubFetch();
	await discoverEndpoints("https://auth.example.com/realms/erp", impl);
	await discoverEndpoints("https://auth.example.com/realms/erp", impl);
	assert.equal(calls.length, 1);
});

test("defaults the auth method list to client_secret_basic when absent", async () => {
	clearDiscoveryCache();
	const { token_endpoint_auth_methods_supported: _omitted, ...withoutMethods } = DOCUMENT;
	const { impl } = stubFetch(withoutMethods);
	const endpoints = await discoverEndpoints("https://auth.example.com/realms/erp", impl);
	assert.deepEqual(endpoints.tokenEndpointAuthMethods, ["client_secret_basic"]);
});

test("throws when the document is missing a required endpoint", async () => {
	clearDiscoveryCache();
	const { token_endpoint: _omitted, ...broken } = DOCUMENT;
	const { impl } = stubFetch(broken);
	await assert.rejects(
		() => discoverEndpoints("https://auth.example.com/realms/erp", impl),
		/token_endpoint/,
	);
});

test("throws and does not cache when the provider responds with an error", async () => {
	clearDiscoveryCache();
	const { impl, calls } = stubFetch(DOCUMENT, 503);
	await assert.rejects(() => discoverEndpoints("https://auth.example.com/realms/erp", impl), /503/);
	await assert.rejects(() => discoverEndpoints("https://auth.example.com/realms/erp", impl), /503/);
	assert.equal(calls.length, 2);
});
