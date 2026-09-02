<img src="/public/icon-96.png" alt="Mailflare" width="72" />

# Mailflare

Mailflare is a self-hosted email inbox for custom domains, built on Cloudflare.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hieunc229/mailflare)

![Mailflare inbox](/screenshot.png)

## What you can do

- Connect domains and set up Cloudflare Email Routing from the dashboard.
- Create personal and shared mailboxes with delegated access.
- Send and receive email with attachments, rich formatting, signatures, and automatic replies.
- Organize mail with search, custom folders, stars, snoozing, archive, spam, and trash.
- Create routing rules to store, forward, reject, or categorize incoming messages.
- Get real-time inbox updates and new-message notifications.
- Import and export mail, manage contacts, and block unwanted senders.
- Manage accounts, permissions, API keys, webhooks, audit logs, and database backups.

## How it works

Mailflare runs in your Cloudflare account. Email Routing delivers incoming messages to the app, while Cloudflare's email service handles outgoing messages. Your mail data stays in your own D1 database and attachments are stored in your own R2 bucket.

## How much does it cost?

You can setup Mailflare and receive email for free

A [Paid Worker](https://developers.cloudflare.com/workers/platform/pricing/) plan ($5/month) is required to send email (and it's recommend to have a smooth experience)

## Deploy

Getting started takes three steps:

1. **Deploy the app.** Click **Deploy to Cloudflare** and keep the app name as `mailflare`. The app will not work correctly under another Worker name.
2. **Complete setup.** Open the deployed app and follow `/setup` to check the installation and create your admin account.
3. **Connect your domain.** Add a domain managed by the same Cloudflare account. Mailflare configures its email routing and helps you create the first mailbox.

`CF_TOKEN` is required during deployment. Use a scoped Cloudflare API token with **Zone Read**, **Email Routing Edit**, **Email Sending Edit**, and **Email Routing Rules Write** permissions for the domains you want to connect. This runtime token is separate from the token Cloudflare uses to deploy the app.

See the [deployment guide](docs/deployment.md) for required permissions, manual deployment, backups, and updates.

## Local development

```bash
cp .dev.vars.example .dev.vars
npm install
npm run db:migrate:local
npm run dev
```

Add your Cloudflare credentials to `.dev.vars`, then open [http://localhost:3000](http://localhost:3000). For sample local data, run `npm run db:seed` while the development server is running.

## Single sign-on (OIDC)

Mailflare can authenticate users against an external OpenID Connect provider (Keycloak, Auth0, Okta, and similar) in addition to, or instead of, its built-in password login. With none of the variables below set, the login page and API behave exactly as they do today — SSO is entirely opt-in.

Setting `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` together enables a "Sign in with SSO" button on the login page. The remaining variables are optional and refine the behavior.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OIDC_ISSUER` | yes | — | Base URL of the provider, e.g. `https://auth.example.com/realms/erp`. Discovery is read from `<issuer>/.well-known/openid-configuration`. |
| `OIDC_CLIENT_ID` | yes | — | OAuth client id. The client must be confidential and support the authorization code flow with PKCE. |
| `OIDC_CLIENT_SECRET` | yes | — | OAuth client secret. Store this as a secret, not as a plain variable. |
| `OIDC_SCOPES` | no | `openid email profile` | Space-separated scopes requested at the provider. Must include `email` — see the warning below. |
| `OIDC_REDIRECT_URI` | no | derived from the request | Explicit callback URL. Set this in production; see below. |
| `OIDC_BUTTON_LABEL` | no | `Sign in with SSO` | Text shown on the login page button. |
| `OIDC_AUTO_PROVISION` | no | `false` | When `true`, a new mailflare account is created on first sign-in for a provider identity that has no matching account. When `false` (default), SSO only links to an *existing* account with a matching email — unknown users are refused. |
| `OIDC_ALLOWED_EMAIL_DOMAINS` | no | unset | Comma-separated list of allowed email domains (e.g. `example.com,example.org`). Restricts sign-in, provisioning, and linking to these domains. |
| `OIDC_GROUPS_CLAIM` | no | unset | Name of the userinfo claim that carries the user's group membership, used together with `OIDC_REQUIRED_GROUP`. |
| `OIDC_REQUIRED_GROUP` | no | unset | Group name that must be present in `OIDC_GROUPS_CLAIM` for sign-in to succeed. Requires `OIDC_GROUPS_CLAIM` to also be set — see below. |
| `OIDC_ONLY` | no | `false` | Disables password sign-in and first-run setup, forcing SSO for every login. Read the lockout warning before enabling this. |

The role (`admin` / `user`) is stored in mailflare's own database and is never read from or updated by the provider. Assign roles the same way you do for password accounts.

### Provider setup

- Register this redirect URI at the provider: `https://<your-host>/api/auth/oidc/callback`.
- Request the `email` scope (included in the default `OIDC_SCOPES`). Without it, mailflare has no email to match against local accounts.
- The provider must return `email_verified: true` on the userinfo response. An identity is only ever linked or created when the email comes back verified — an unverified email is treated as if no account exists.
- Do not register a wildcard or prefix-matching redirect URI at the provider. That is the one misconfiguration that would let an attacker redirect the authorization response elsewhere and steal a code — always register the exact, full callback URL.

#### Keycloak example

1. Create a client in your realm: **Client type** `OpenID Connect`, **Client authentication** on (confidential), **Standard flow** enabled, all other flows disabled.
2. Set **Valid redirect URIs** to exactly `https://<your-host>/api/auth/oidc/callback`.
3. Copy the **Client secret** from the client's **Credentials** tab.
4. Set:
   - `OIDC_ISSUER` = `https://<keycloak-host>/realms/<realm>`
   - `OIDC_CLIENT_ID` = the client id from step 1
   - `OIDC_CLIENT_SECRET` = the secret from step 3
5. To restrict sign-in to a Keycloak group, add a group membership mapper to the client that publishes a `groups` claim on the userinfo endpoint, then set `OIDC_GROUPS_CLAIM=groups` and `OIDC_REQUIRED_GROUP=<group-name>`.

### Sign-in behavior and filters

`OIDC_ALLOWED_EMAIL_DOMAINS` and `OIDC_REQUIRED_GROUP` are evaluated on **every** sign-in, not just the first one. If you remove someone from the required group at the provider, their next sign-in is denied even though they were previously linked — filters act as an access control, not a one-time gate.

For an account that is already linked to a provider identity, the domain filter checks the email address stored in mailflare, not the one the provider just sent. This is deliberate: a user can change their own email at the provider, and mailflare should not let that silently move them in or out of an allowed domain.

### `OIDC_REQUIRED_GROUP` needs `OIDC_GROUPS_CLAIM`

Setting `OIDC_REQUIRED_GROUP` without also setting `OIDC_GROUPS_CLAIM` is treated as a misconfiguration, not as "no restriction". Single sign-on is disabled entirely: `/api/auth/oidc/start` responds `503` and the missing variable is logged. A group restriction that silently does nothing would be worse than no restriction at all, so this fails closed instead.

### Warning: removing `email` from `OIDC_SCOPES` while a domain filter is set locks everyone out

If `OIDC_ALLOWED_EMAIL_DOMAINS` is configured but the provider does not return an email (for example because `email` was removed from `OIDC_SCOPES`), the domain filter has nothing to check and fails closed — refusing every sign-in, including administrators. Combined with `OIDC_ONLY`, this is a total lockout with no password fallback. Keep `email` in `OIDC_SCOPES` whenever a domain filter is configured.

### Warning: set `OIDC_REDIRECT_URI` explicitly in production

When `OIDC_REDIRECT_URI` is unset, mailflare derives it from the incoming request's own origin. This works when the app is reachable on exactly one hostname. If it is reachable on more than one (an apex domain and `www`, or a custom domain alongside the `workers.dev` URL), the authorize request and the token exchange can be built against different origins, and the provider will reject the exchange with a confusing `invalid_grant` error. Set `OIDC_REDIRECT_URI` to the single canonical callback URL in any production deployment.

### Warning: `OIDC_ONLY` is a lockout risk

With `OIDC_ONLY=true`:

- Password sign-in is refused server-side (`POST /api/auth/login` returns `403`), even if a user knows a valid password.
- First-run setup is refused too (`403`) — **the first administrator account cannot be created through single sign-on.** Deploy without `OIDC_ONLY`, complete `/setup` to create the first admin, and only then set `OIDC_ONLY=true`.
- A password set through the account settings page has no effect while `OIDC_ONLY` is enabled — it is stored but ignored at login.
- If the provider becomes unreachable or misconfigured while `OIDC_ONLY` is enabled, there is **no other way to sign in**. The only recovery is to unset `OIDC_ONLY` and redeploy.

### Auto-provisioned users have no mailbox

When `OIDC_AUTO_PROVISION=true` creates a new account on first sign-in, that account has no mailbox — unlike the normal first-run and admin-created account paths, which create one automatically. An administrator must assign the new user a mailbox after their first sign-in.

### What SSO does not do

- **No single logout.** Signing out of mailflare ends only the mailflare session; it does not sign the user out of the provider.
- **No role sync.** Roles (`admin` / `user`) live in mailflare and are never read from or written by the provider, regardless of any group or role claims it sends.
- **One provider only.** Mailflare supports exactly one OIDC provider at a time; there is no multi-provider selection.
- **No ID token validation.** Identity is established by calling the provider's `/userinfo` endpoint with the access token obtained over TLS, not by verifying the ID token's signature.

## Documentation

- [Deployment and configuration](docs/deployment.md)
- [API and integrations](docs/api.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

See [LICENSE](LICENSE).
