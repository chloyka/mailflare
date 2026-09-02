export type AuthActivityAction = "auth.login" | "auth.login.oidc" | "auth.logout";

export type AuthActivityMetadata = {
	ipAddress: string;
	city: string | null;
	country: string | null;
	device: string;
	platform: string;
	userAgent: string;
};
