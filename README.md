# FW Migrate

Firewall rule-base migration between vendors. Paste or upload a source configuration; FW Migrate parses it into a vendor-neutral model, analyses the rule base, translates every rule to the target vendor's syntax and lets an engineer review each rule before exporting a complete target configuration.

Translation is deterministic. An LLM is optional and only adds plain-language explanations and zone-mapping suggestions; it never writes or changes the generated config.

## Why

Firewall migrations are mostly careful bookkeeping: hundreds of rules, objects and services that have to be re-expressed in another vendor's syntax without changing what traffic is allowed. FW Migrate does the mechanical translation, flags anything it cannot translate exactly, and keeps a human approval step for every rule.

## Workflow

```
Import config -> Parse -> Analyse -> Translate -> Review -> Export
```

1. **Import** a configuration (paste or drag-and-drop).
2. **Parse** it with the vendor's parser into rules, address/service objects and NAT rules.
3. **Analyse** the rule base: unused/disabled rules, shadowed rules, overly permissive (any/any) rules, risk score.
4. **Translate** each rule with the target vendor's generator. Every rule gets a confidence score and review flags.
5. **Review** rule by rule: approve, modify, skip or flag.
6. **Export** the target configuration (objects + rules), a migration plan (checklists, per-rule rollback commands) or a summary report.

## Supported vendors

Every vendor below has a parser, a generator and tests for both (`tests/parsers/`, `tests/generators/`). Any vendor can be the source or the target.

| Vendor | Source format (parser) | Target format (generator) |
|---|---|---|
| Palo Alto Networks (PAN-OS) | XML config export or `set` commands | `set` commands |
| Cisco ASA | `show running-config` | CLI: objects, extended ACLs, `access-group` |
| Check Point (R80+) | Management API JSON (`show access-rulebase` with objects dictionary) | `mgmt_cli` script |
| Fortinet FortiGate (FortiOS) | FortiOS CLI config | FortiOS CLI config |
| Juniper SRX (Junos) | `set` commands | `set` commands |

The list lives in one place, `src/lib/vendors.ts`; the API validators, the Prisma enum (checked by `tests/vendors.test.ts`), the parser/generator factories and the UI all derive from it.

## How translation works

Parsers keep each vendor's own tokens on the rule (`application-default`, `any`, `ALL`, `junos-https`, `tcp/443`, `tcp-8443`, ...). Generators never copy those tokens into another vendor's syntax:

- **Services** are first resolved to protocol/port specs (`src/lib/generators/services.ts`), then each target uses its own predefined service (FortiOS `HTTPS`/`DNS`/`PING`, Junos `junos-https`, Check Point `https`/`domain-udp`, PAN-OS `service-https`) or emits a custom service object.
- **PAN-OS App-ID with `application-default`** is resolved from the rule's applications to their standard ports: `ssl` -> 443, `web-browsing` -> 80, `dns` -> 53, `ssh`, `telnet`, `ftp`, `smtp`, `pop3`, `imap`, `ntp`, `snmp`, `syslog`, `ldap`, `ms-rdp`, `tftp`, `mssql-db`, `mysql`, `ms-ds-smb`, `kerberos`, `bgp`, `ping`, `icmp`. The App-IDs stay visible in the target rule's comment/description (and are kept as App-ID when the target is PAN-OS). Layer-7 enforcement is not carried over and the rule says so.
- **Anything that cannot be mapped** (an unknown App-ID, a service name not defined in the source) lowers the rule's confidence and adds a `REVIEW:` flag. A rule with no resolvable service is emitted **disabled**, never as a live rule with a guessed service.
- **Objects**: every address, group and service a rule references is emitted before the rules, including objects created for literal IPs, ranges and FQDNs used directly in rules (SRX and FortiOS policies cannot reference literals).
- **Zones**: zone mappings from the project are applied. ASA rules go into `<nameif>_access_in` ACLs bound with `access-group` (source zone `any` -> global ACL, flagged); SRX rules with an `any` zone become global policies; Check Point rules carry a flag that zones need security-zone objects.
- **Any vs all**: `any` becomes `all`/`ALL` on FortiOS, `Any` on Check Point, `ip` on ASA, `any` on PAN-OS and Junos.

`tests/generators/cross-vendor.test.ts` runs every source fixture through every generator and checks that each referenced object is defined or predefined and that no other vendor's keywords appear in the output.

## Quick start

Works the same on Windows (PowerShell or Git Bash), Linux and macOS.

Requirements: Git, Node.js 22 or newer, Docker with Compose. An LLM is not required.

```bash
git clone https://github.com/falshaw/fwmigrate.git
cd fwmigrate
cp .env.example .env
```

Open `.env` and fill in the four empty secrets (`POSTGRES_PASSWORD`, `FWMIGRATE_DB_PASSWORD`, `REDIS_PASSWORD`, `AUTH_SECRET`). Generate each one with either command, which gives a 64-character hex string:

```bash
openssl rand -hex 32
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If port 3004, 5436 or 6383 is already taken on your machine, change `APP_PORT`, `POSTGRES_PORT` or `REDIS_HOST_PORT` in `.env` (and the port in `NEXTAUTH_URL`).

Install, check and start:

```bash
npm install --include=dev
npx prisma generate
npm run typecheck
npm test
docker compose up -d --build
```

Create the schema and the demo admin (runs from the host against the Postgres container; the connection string is built from `POSTGRES_PASSWORD` and `POSTGRES_PORT`):

```bash
npx prisma db push
npx prisma db seed
```

The seed prints the login (`admin@demo.local` and a random password, or `SEED_ADMIN_PASSWORD` if set). Open http://localhost:3004 (or your `APP_PORT`).

To try it, create a migration (for example Palo Alto -> Fortinet), import `tests/fixtures/paloalto-config.xml`, then run analyse, translate and review.

`npm install --include=dev` matters: the type checker, test runner, Prisma CLI and `tsx` (used by the seed) are dev dependencies, and npm skips them when `NODE_ENV=production` or `omit=dev` is set in your npm config.

Stop the stack with `docker compose down` (add `-v` to delete the database volume).

## Optional LLM

Set `LLM_PROVIDER` in `.env` and recreate the app container (`docker compose up -d fwmigrate-app`):

| `LLM_PROVIDER` | What it does |
|---|---|
| `none` (default) | No LLM. Translation, analysis, review and export all work. Zone mapping defaults to identity mapping. |
| `ollama` | Calls Ollama's API at `OLLAMA_HOST` (default `http://host.docker.internal:11434`) with `OLLAMA_MODEL`. |
| `claude` | Sends `POST {CLAUDE_BRIDGE_URL}/generate` with an `X-Bridge-Token` header to a host-side gateway, so the container never holds a model API key. A compatible gateway is in the companion repo [secure-private-ai](https://github.com/falshaw/secure-private-ai). |

Translate returns immediately either way. With an LLM configured, per-rule explanations run afterwards as a background job, bounded by `LLM_TIMEOUT_MS` per call, `LLM_CONCURRENCY` parallel calls and `LLM_EXPLAIN_MAX_RULES` rules per run; `GET /api/v1/projects/{id}/translate` reports progress. LLM calls sit behind a circuit breaker.

## Features

- Parsing into a shared intermediate model (rules, address/service objects, NAT)
- Rule analysis: shadow detection, permissive-rule detection, risk scoring (`src/lib/analysis/`)
- Vendor-specific syntax validation of raw configs (`src/lib/validation/ConfigValidator.ts`)
- Deterministic translation with per-rule confidence and review flags
- Per-rule review with manual overrides and version history
- Batch migrations (up to 50 configs per batch)
- Exports: complete target config, migration plan with rollback commands, report
- Optional push of approved rules to an external change-management system over HTTP
- Multi-tenant: users belong to an organisation; all data is organisation-scoped
- Roles: `ADMIN`, `CONSULTANT`, `VIEWER`

## Architecture

```
Browser ──> Next.js app (UI + /api routes, NextAuth sessions)
              ├── PostgreSQL 16 (Prisma 7 + @prisma/adapter-pg)
              ├── Redis (rate limiting, caching)
              ├── optional LLM: Ollama or an authenticated HTTP LLM gateway
              └── optional external change-management API
```

- **Auth**: NextAuth v5 credentials provider, bcrypt password hashes, role-based access.
- **API**: REST under `/api/v1/*`. Every route goes through `apiHandler` (session check, Zod validation, Redis rate limit, correlation ID, structured logging).
- **Change-management push**: `POST /api/v1/integrate/change-manager` sends approved/modified rules as JSON to `{CHANGE_MANAGER_API_URL}/api/rules/import`; `GET /api/v1/integrate/status` probes `{CHANGE_MANAGER_API_URL}/api/health`. Any system exposing those two endpoints works.
- **Container hardening**: all services drop all capabilities and set `no-new-privileges`; the app runs read-only as a non-root user with tmpfs for `/tmp` and `.next/cache`; Postgres creates a separate least-privilege `fwmigrate` role (`postgres/init-user.sh`) that the app uses. Host ports bind to `127.0.0.1` only.

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Prisma 7, PostgreSQL 16, Redis, NextAuth v5, Zod, fast-xml-parser, ipaddr.js, Vitest.

## Local development

With Postgres and Redis from Compose (`docker compose up -d fwmigrate-postgres fwmigrate-redis`) and the schema pushed:

```bash
npm install --include=dev
npx prisma generate
npm run dev               # http://localhost:3004
```

`npm run dev` connects as the Postgres superuser built from `POSTGRES_PASSWORD`; set `DATABASE_URL` to use another database.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Postgres superuser password (schema push, seed, local dev) |
| `FWMIGRATE_DB_PASSWORD` | yes | Password of the app's least-privilege DB role |
| `REDIS_PASSWORD` | yes | Redis auth |
| `AUTH_SECRET` | yes | NextAuth secret, at least 32 characters (`openssl rand -hex 32`) |
| `APP_PORT` / `POSTGRES_PORT` / `REDIS_HOST_PORT` | no | Host ports, default `3004` / `5436` / `6383` (bound to 127.0.0.1) |
| `NEXTAUTH_URL` | no | Public URL, default `http://localhost:3004` |
| `DATABASE_URL` | no | Only to override the connection string built from `POSTGRES_PASSWORD` (Compose sets the container's own) |
| `SEED_ADMIN_PASSWORD` | no | Seed admin password (random if unset) |
| `LLM_PROVIDER` | no | `none` (default), `ollama` or `claude` |
| `OLLAMA_HOST` / `OLLAMA_MODEL` | no | Default `http://host.docker.internal:11434` / `qwen2.5:14b` |
| `LLM_TIMEOUT_MS` / `LLM_CONCURRENCY` / `LLM_EXPLAIN_MAX_RULES` | no | Per-call timeout (90000), parallel calls (2), rules explained per run (50) |
| `CLAUDE_BRIDGE_URL` / `CLAUDE_BRIDGE_TOKEN` / `CLAUDE_MODEL` | no | LLM gateway URL, shared token, model alias |
| `CHANGE_MANAGER_API_URL` / `CHANGE_MANAGER_API_KEY` | no | External change-management system and its bearer token |
| `ENCRYPTION_KEY` | no | 64 hex chars, used by `src/lib/crypto.ts` |

## Tests

```bash
npm test                  # Vitest
npm run test:coverage
npm run typecheck
npm run lint
```

- `tests/parsers/`: each parser against a synthetic config in `tests/fixtures/`.
- `tests/generators/`: PAN-OS fixture -> FortiOS in detail, plus every source/target pair for valid references and leaked keywords.
- `tests/analysis/`, `__tests__/`: rule analysis engine, network utilities, crypto.
- `tests/vendors.test.ts`: the vendor list, Prisma enum, API validation and this README agree.

The fixtures use only RFC 5737 documentation addresses, RFC 1918 ranges and `example.com` names.

## License

MIT, see [LICENSE](LICENSE).
