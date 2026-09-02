interface CloudflareEnv {
	DB: D1Database;
	EMAIL: SendEmail;
	BUCKET: R2Bucket;
	INBOUND_QUEUE: Queue<import("./src/lib/email/inbound").InboundQueueMessage>;
	OUTBOUND_QUEUE: Queue<import("./src/lib/email/send").OutboundQueueMessage>;
	ASSETS: Fetcher;
	IMAGES: ImagesBinding;
	WORKER_SELF_REFERENCE: Fetcher;
	REALTIME: DurableObjectNamespace<
		import("./src/lib/realtime/hub").RealtimeHub
	>;
	DATABASE_BACKUP_WORKFLOW?: Workflow<import("./src/lib/backups/types").BackupWorkflowParams>;
	LOGIN_RATE_LIMIT?: RateLimit;
	CF_TOKEN?: string;
	CF_API_KEY?: string;
	CF_EMAIL?: string;
	CF_AID?: string;
	D1_DATABASE_ID?: string;
	D1_BACKUP_TOKEN?: string;
	TURNSTILE_SECRET_KEY?: string;
	GITHUB_UPDATE_TOKEN?: string;
	GITHUB_UPDATE_REF?: string;
	GITHUB_UPDATE_REPO?: string;
	OIDC_ISSUER?: string;
	OIDC_CLIENT_ID?: string;
	OIDC_CLIENT_SECRET?: string;
	OIDC_SCOPES?: string;
	OIDC_REDIRECT_URI?: string;
	OIDC_BUTTON_LABEL?: string;
	OIDC_AUTO_PROVISION?: string;
	OIDC_ALLOWED_EMAIL_DOMAINS?: string;
	OIDC_GROUPS_CLAIM?: string;
	OIDC_REQUIRED_GROUP?: string;
	OIDC_ONLY?: string;
}
