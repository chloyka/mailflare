import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { buildAuthorizationUrl } from "@/lib/oidc/client";
import { readOidcConfig } from "@/lib/oidc/config";
import { OIDC_COOKIE_PATH, OIDC_STATE_COOKIE, OIDC_VERIFIER_COOKIE, resolveRedirectUri } from "@/lib/oidc/cookies";
import { discoverEndpoints } from "@/lib/oidc/discovery";
import { codeChallengeS256, randomUrlSafeToken } from "@/lib/oidc/pkce";

export const dynamic = "force-dynamic";

const TEMP_COOKIE_MAX_AGE = 600;

export async function GET(request: Request) {
	const env = getEnv();
	const result = readOidcConfig(env as unknown as Record<string, unknown>);

	if (result.status === "disabled") {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}
	if (result.status === "incomplete") {
		console.error(`OIDC is partially configured; missing: ${result.missing.join(", ")}`);
		return NextResponse.json({ error: "Single sign-on is misconfigured" }, { status: 503 });
	}

	const config = result.config;
	let authorizationUrl: string;
	const state = randomUrlSafeToken();
	const verifier = randomUrlSafeToken();

	try {
		const endpoints = await discoverEndpoints(config.issuer);
		authorizationUrl = buildAuthorizationUrl({
			endpoints,
			config,
			redirectUri: resolveRedirectUri(request, config),
			state,
			codeChallenge: await codeChallengeS256(verifier),
		});
	} catch (error) {
		console.error("OIDC discovery failed", error);
		return NextResponse.redirect(new URL("/login?sso_error=exchange_failed", request.url), 302);
	}

	const response = NextResponse.redirect(authorizationUrl, 302);
	response.headers.set("Cache-Control", "no-store");
	const cookieOptions = {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax" as const,
		path: OIDC_COOKIE_PATH,
		maxAge: TEMP_COOKIE_MAX_AGE,
	};
	response.cookies.set(OIDC_STATE_COOKIE, state, cookieOptions);
	response.cookies.set(OIDC_VERIFIER_COOKIE, verifier, cookieOptions);
	return response;
}
