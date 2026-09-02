import type { OidcConfig } from "@/lib/oidc/config";

export const OIDC_STATE_COOKIE = "mf_oidc_state";
export const OIDC_VERIFIER_COOKIE = "mf_oidc_verifier";
export const OIDC_COOKIE_PATH = "/api/auth/oidc";

export function resolveRedirectUri(request: Request, config: OidcConfig): string {
	if (config.redirectUri) return config.redirectUri;
	return new URL("/api/auth/oidc/callback", new URL(request.url).origin).toString();
}
