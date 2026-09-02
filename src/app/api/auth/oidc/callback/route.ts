import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { recordAuthActivity } from "@/lib/auth/activity";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { getEnv } from "@/lib/cloudflare";
import { exchangeAuthorizationCode, fetchUserinfo } from "@/lib/oidc/client";
import { readOidcConfig } from "@/lib/oidc/config";
import { OIDC_COOKIE_PATH, OIDC_STATE_COOKIE, OIDC_VERIFIER_COOKIE, resolveRedirectUri } from "@/lib/oidc/cookies";
import { discoverEndpoints } from "@/lib/oidc/discovery";
import { parseUserinfo, resolveOidcUser } from "@/lib/oidc/identity";
import type { OidcClaims, ResolveResult } from "@/lib/oidc/identity";
import { safeCompare } from "@/lib/oidc/pkce";
import { createIdentityStore } from "@/lib/oidc/store";

export const dynamic = "force-dynamic";

const SESSION_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;

function failure(request: NextRequest, code: string) {
	const response = NextResponse.redirect(new URL(`/login?sso_error=${code}`, request.url), 302);
	response.headers.set("Cache-Control", "no-store");
	response.cookies.delete({ name: OIDC_STATE_COOKIE, path: OIDC_COOKIE_PATH });
	response.cookies.delete({ name: OIDC_VERIFIER_COOKIE, path: OIDC_COOKIE_PATH });
	return response;
}

export async function GET(request: NextRequest) {
	const env = getEnv();
	const result = readOidcConfig(env as unknown as Record<string, unknown>);
	if (result.status !== "enabled") {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}
	const config = result.config;

	const params = request.nextUrl.searchParams;
	if (params.get("error")) {
		console.warn("OIDC provider returned an error", { error: params.get("error")?.slice(0, 64) });
		return failure(request, "access_denied");
	}

	const code = params.get("code");
	const state = params.get("state");
	const expectedState = request.cookies.get(OIDC_STATE_COOKIE)?.value;
	const verifier = request.cookies.get(OIDC_VERIFIER_COOKIE)?.value;

	if (!code || !state || !expectedState || !verifier || !safeCompare(state, expectedState)) {
		console.warn("OIDC callback rejected: state or verifier missing or mismatched");
		return failure(request, "state_mismatch");
	}

	let claims: OidcClaims;
	let issuer: string;
	let resolved: ResolveResult;
	try {
		const endpoints = await discoverEndpoints(config.issuer);
		issuer = endpoints.issuer;
		const accessToken = await exchangeAuthorizationCode({
			endpoints,
			config,
			redirectUri: resolveRedirectUri(request, config),
			code,
			codeVerifier: verifier,
		});
		claims = parseUserinfo(await fetchUserinfo({ endpoints, accessToken }), config.groupsClaim);
		resolved = await resolveOidcUser({
			issuer,
			claims,
			policy: {
				autoProvision: config.autoProvision,
				allowedEmailDomains: config.allowedEmailDomains,
				requiredGroup: config.requiredGroup,
			},
			store: createIdentityStore(env),
		});
	} catch (error) {
		// Covers discovery/exchange/userinfo failures and unexpected store errors, including
		// the loser of a concurrent first-login race hitting the UNIQUE(issuer, subject) index.
		// Never let the raw error surface to the client; only console.error it for diagnosis.
		console.error("OIDC code exchange failed", error);
		return failure(request, "exchange_failed");
	}

	if (!resolved.ok) {
		console.warn("OIDC sign-in refused", { subject: claims.subject.slice(0, 64), code: resolved.code });
		return failure(request, resolved.code);
	}

	const token = await createSession(env, resolved.user.id);
	await recordAuthActivity(env, { action: "auth.login.oidc", userId: resolved.user.id, request });

	const response = NextResponse.redirect(new URL("/inbox", request.url), 302);
	response.headers.set("Cache-Control", "no-store");
	response.cookies.delete({ name: OIDC_STATE_COOKIE, path: OIDC_COOKIE_PATH });
	response.cookies.delete({ name: OIDC_VERIFIER_COOKIE, path: OIDC_COOKIE_PATH });
	response.cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: SESSION_DAYS_IN_SECONDS,
	});
	return response;
}
