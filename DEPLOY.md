# Mailflare — self-host сборка нашего форка

Форк `hieunc229/mailflare` v0.2.0. Сборка соответствует последней прод-версии форка: 30 коммитов поверх upstream (`origin/main..deploy/aejuice` @ `3284dab`), тесты 63/63.

---

## Доработки форка

### SSO через Keycloak (или любой OIDC: Auth0, Okta, …)

Провайдер-агностичный OIDC-логин, ноль новых зависимостей: PKCE на WebCrypto, личность берётся из `/userinfo` по токену с token endpoint (ID-токен не разбирается, JWKS не нужен), discovery-документ кэшируется и сверяется с настроенным issuer.

**На стороне Keycloak:**

1. Clients → Create client: **Client authentication: ON** (confidential), flow **Standard** (authorization code). PKCE поддерживается из коробки, отдельно включать не нужно.
2. **Valid redirect URIs**: ровно `https://<ваш-хост>/api/auth/oidc/callback`
3. Вкладка **Credentials** → скопировать Client secret.
4. (Опционально, для фильтра по группе) Client scopes → Mappers → добавить group-membership mapper, чтобы на userinfo endpoint появился claim `groups`.

**Переменные** (обязательная тройка включает кнопку «Sign in with SSO»; без них поведение апстрима не меняется):

```bash
OIDC_ISSUER       = https://<keycloak-хост>/realms/<realm>   # БЕЗ хвостового слеша
OIDC_CLIENT_ID    = <id клиента из шага 1>
OIDC_CLIENT_SECRET= <secret из шага 3>                       # хранить как secret, не как plain var
```

Опции: `OIDC_AUTO_PROVISION` (default `false`), `OIDC_ALLOWED_EMAIL_DOMAINS`, `OIDC_GROUPS_CLAIM` + `OIDC_REQUIRED_GROUP`, `OIDC_ONLY`, `OIDC_REDIRECT_URI`, `OIDC_BUTTON_LABEL`, `OIDC_SCOPES`. Полная таблица и предупреждения — README.md → **Single sign-on (OIDC)**.

**Модель безопасности — коротко:**

- **Link-only по умолчанию**: SSO привязывается только к *уже существующим* аккаунтам с тем же email, и только если провайдер отдал `email_verified: true`. Чужой адрес в IdP не даёт вход в чужой ящик.
- **Фильтры проверяются на каждый вход**, а не только при привязке: убрали человека из группы в Keycloak → его следующий вход запрещён, даже если он уже был связан.
- `OIDC_REQUIRED_GROUP` без `OIDC_GROUPS_CLAIM` = misconfiguration: SSO целиком отключается (`503`), fail-closed.
- Роль живёт в базе mailflare, из IdP не маппится: новый SSO-юзер создаётся как `role=user`, админом его делает админ в UI.
- Auto-provision создаёт юзеров с id вида `usr_…`, привязанными к старейшему админу, — управляемы всеми админами (см. фикс ниже).

**Три способа закрыть себя на замок (из README):**

1. `OIDC_ONLY=true` без рабочего SSO = полный lockout без парольного фолбэка.
2. Убрать `email` из `OIDC_SCOPES` при настроенном домен-фильтре = фильтр fail-closed на всех, включая админов.
3. Не задать `OIDC_REDIRECT_URI` в проде при нескольких хостнеймах (custom domain + workers.dev) = `invalid_grant` на обмене кода.

### Другие фиксы

- **Instance-wide админка** — все админы видят и редактируют *все* аккаунты, а не только созданные собой (апстрим скопил по `createdByUserId` и отдавал «Account not found» на чужих аккаунтах). Регресс-гард: `tests/accounts-admin-access.test.mjs`.
- **Сохранение аккаунта с пустым forwardingEmail** больше не падает — админская форма не ломается на аккаунтах без пересылки.
- **`LICENSE_PLAN_OVERRIDE=team`** — опциональное снятие plan-гейтов апстрима для self-host (env-гейт, по умолчанию выключено; апстрим перелицензирован на AGPL-3.0, запуск модифицированной версии разрешён).
- Логин-ошибка рендерится **над** формой — видна и при `OIDC_ONLY`, когда форма скрыта.
- `npm test` — прогон node:test-сьюта (63 теста, включая source-level гварды миграций и админских роутов).

---

## Перед деплоем — что и куда добавить

### 1. `wrangler.jsonc` → `database_id` (единственное ОБЯЗАТЕЛЬНОЕ поле)

Без него деплой упадёт. Создайте базу и впишите её id в блок `d1_databases`:

```bash
npx wrangler d1 create mailflare
# в выводе будет database_id: "<uuid>"
```

```jsonc
	"d1_databases": [
		{
			"binding": "DB",
			"database_name": "mailflare",
			"database_id": "<ВПИШИТЕ UUID СЮДА>",   // ← единственное, что обязательно
			"migrations_dir": "drizzle/migrations",
		},
	],
```

### 2. Имя воркера (опционально) — менять в ДВУХ местах синхронно

Воркер ссылается сам на себя (так отправляется исходящая почта). Если меняете имя — поменяйте в обоих местах:

```jsonc
	"name": "mailflare",                                                // место 1
	"services": [ { "binding": "WORKER_SELF_REFERENCE", "service": "mailflare" } ],  // место 2
```

Имена ресурсов (`database_name`, `bucket_name`, имена queues) тоже можно менять — просто создайте их с теми же именами, что пропишете в конфиге.

### 3. Свой домен (опционально) — вернуть блок `routes` в `wrangler.jsonc`

```jsonc
	"routes": [
		{
			"pattern": "mail.example.com",
			"custom_domain": true,
			"zone_name": "example.com",
		},
	],
```

Без этого воркер будет доступен на `https://mailflare.<account>.workers.dev` (`workers_dev: true` уже включён).

### 4. Переменные и секреты — ДО деплоя

Куда: dash → Worker → Settings → Variables and Secrets, либо `npx wrangler secret put <ИМЯ>`.
Для чисто свежего воркера удобнее вторым шагом после первого деплоя (воркер должен существовать).

| Переменная | Обязательна? | Зачем |
|---|---|---|
| `CF_TOKEN` | да (для онбординга доменов из UI) | runtime-токен Cloudflare: Zone Read, Email Routing Edit, Email Sending Edit, Email Routing Rules Write |
| `TURNSTILE_SECRET_KEY` | да (логин/регистрация) | проверка капчи |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | да (логин/регистрация) | **инлайнится при сборке**: если деплоите пересборкой — `export NEXT_PUBLIC_TURNSTILE_SITE_KEY=…` ПЕРЕД `npm run deploy` |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | для SSO | включают кнопку «Sign in with SSO» (рецепт Keycloak — выше) |
| `CF_AID`, `D1_DATABASE_ID` | для бэкапов | авторезервное копирование D1 (workflow ежедневно в 02:00 UTC) |
| `LICENSE_PLAN_OVERRIDE=team` | нет | открыть plan-гейтнутые фичи |

Полный список — `.dev.vars.example`.

---

## Деплой

```bash
npm ci
npx wrangler login            # или export CLOUDFLARE_API_TOKEN=…

# ресурсы с нуля:
npx wrangler d1 create mailflare            # id → wrangler.jsonc (см. выше)
npx wrangler r2 bucket create mailflare-raw
npx wrangler queues create mailflare-inbound
npx wrangler queues create mailflare-outbound

npm run deploy                # opennextjs-cloudflare build + D1-миграции + wrangler deploy
```

Готовый билд уже лежит в `.open-next/` — можно задеплоить без пересборки: `npx wrangler deploy`.

## Почта

1. В зоне домена: Email Routing → Enable.
2. Правило catch-all (или точные адреса) → отправка в этот Worker (входящая почта).
3. Исходящая — через встроенный `send_email` (уже в конфиге); адрес отправителя подтверждается в Email Routing.

## Грабли

- Если в окружении живёт `CLOUDFLARE_PERSONAL_API_TOKEN`, команды `wrangler d1 … --remote` падают с `7403 account not authorized` — запускайте как `env -u CLOUDFLARE_PERSONAL_API_TOKEN npx wrangler …`.
- `npx tsc --noEmit` местами красный — старые ошибки UI/calendar/backups из upstream, не блокер.
- Полноценно задеплоить «заливкой файла через UI» нельзя (assets, Queues, Durable Objects, Workflows задаёт только wrangler) — путь деплоя через npm/wrangler, как выше.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` меняется только пересборкой (см. таблицу выше).
- Схема БД продублирована (миграции + `INITIAL_SCHEMA_SQL` в `src/lib/setup/migration.ts`): любая миграция = три синхронные правки, иначе сломается bootstrap новой инсталляции. Гвард: `tests/setup-bootstrap-schema.test.mjs`.
