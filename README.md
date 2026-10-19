# FW Migrate

AI-assisted firewall rule migration between vendors. Paste or upload a source firewall configuration, FW Migrate parses it into a vendor-neutral model, analyses the rule base, translates it to the target vendor's syntax and lets an engineer review every rule before exporting the result.

## Why

Firewall migrations are mostly careful bookkeeping: hundreds of rules, objects and NAT entries that have to be re-expressed in another vendor's syntax without changing what traffic is allowed. FW Migrate automates the mechanical translation, flags risky or dead rules on the way, and keeps a human approval step for every rule.

## Workflow

```
Import config -> Parse -> Analyse -> Translate -> Review -> Export
```

1. **Import** a configuration file (paste or drag-and-drop).
2. **Parse** it with the vendor-specific parser into normalised rules, objects and NAT rules.
3. **Analyse** the normalised rule base: unused/disabled rules, shadowed rules, overly permissive (any/any) rules, risk score.
4. **Translate** each rule with the target vendor's generator. An LLM suggests zone mappings and explains rules; every translation carries a confidence score.
5. **Review** rule by rule: approve, modify, skip or flag.
6. **Export** the target configuration, a migration plan (checklist + rollback steps) or a summary report.

## Supported vendors

| Vendor | Source format |
|---|---|
| Palo Alto (PAN-OS) | XML |
| Cisco ASA / FTD | CLI (`show running-config`) |
| Check Point | JSON export |
| Fortinet (FortiOS) | CLI |
| Juniper SRX | `set` commands |
| Sophos | CLI |
| SonicWall | CLI |
| WatchGuard | XML |
| pfSense | XML |
| MikroTik | RouterOS |

Every vendor has a parser (`src/lib/parsers/`) and a generator (`src/lib/generators/`); Cisco FTD reuses the ASA pair. `ParserFactory` and `GeneratorFactory` select them by vendor.

## Features

- Multi-vendor parsing into a shared intermediate model (rules, objects, NAT)
- Rule analysis engine with shadow detection, permissive-rule detection and risk scoring (`src/lib/analysis/`)
- Vendor-specific syntax validation of raw configs (`src/lib/validation/ConfigValidator.ts`)
- AI rule explanations, optimisation suggestions and zone-mapping suggestions
- Per-rule review with manual overrides and version history
- Batch migrations (up to 50 configs per batch)
- Exports: target config, migration plan, report
- Optional push of approved rules to an external change-management system over HTTP
- Multi-tenant: users belong to an organisation; all data is organisation-scoped
- Roles: `ADMIN`, `CONSULTANT`, `VIEWER`

## Architecture

```
Browser ──> Next.js app (UI + /api routes, NextAuth sessions)
              ├── PostgreSQL 16 (Prisma 7 + @prisma/adapter-pg)
              ├── Redis (rate limiting, caching)
              ├── LLM: Ollama (default) or an authenticated HTTP LLM gateway
              └── optional external change-management API
```

- **Auth**: NextAuth v5 credentials provider, bcrypt password hashes, role-based access.
- **API**: REST under `/api/v1/*`. Every route goes through `apiHandler` (session check, Zod validation, Redis rate limit, correlation ID, structured logging).
- **LLM provider**: `LLM_PROVIDER=ollama` calls Ollama's API directly. `LLM_PROVIDER=claude` sends `POST {CLAUDE_BRIDGE_URL}/generate` with an `X-Bridge-Token` header to a host-side gateway, so the container never holds a model API key. A compatible gateway is in the companion repo [secure-private-ai](https://github.com/falshaw/secure-private-ai). AI calls sit behind a circuit breaker; translation still works without AI (identity zone mapping, no explanations).
- **Change-management push**: `POST /api/v1/integrate/change-manager` sends approved/modified rules as JSON to `{CHANGE_MANAGER_API_URL}/api/rules/import`; `GET /api/v1/integrate/status` probes `{CHANGE_MANAGER_API_URL}/api/health`. Any system exposing those two endpoints works.

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Prisma 7, PostgreSQL 16, Redis, NextAuth v5, Zod, fast-xml-parser, ipaddr.js, Vitest.

## Running with Docker

Requirements: Docker with Compose. Ollama on the host is optional (AI features degrade gracefully without it).

```bash
cp .env.example .env          # fill in every secret
docker compose up -d --build
```

The stack publishes on localhost only:

| Service | Host port |
|---|---|
| App | http://localhost:3004 |
| PostgreSQL | 127.0.0.1:5436 |
| Redis | 127.0.0.1:6383 |

On first start, create the schema and seed a demo admin from the host (uses `DATABASE_URL` from `.env`, which points at the superuser):

```bash
npm install
npx prisma generate
npx prisma db push
npx prisma db seed        # prints the admin login (admin@demo.local)
```

Container hardening: all services drop all capabilities and set `no-new-privileges`; the app runs read-only as a non-root user with tmpfs for `/tmp` and `.next/cache`; Postgres creates a separate least-privilege `fwmigrate` role (`postgres/init-user.sh`) that the app uses.

## Local development

```bash
npm install
npx prisma generate
npm run dev               # http://localhost:3004
```

Postgres and Redis can come from `docker compose up -d fwmigrate-postgres fwmigrate-redis`.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Postgres superuser password |
| `FWMIGRATE_DB_PASSWORD` | yes | Password of the app's least-privilege DB role |
| `REDIS_PASSWORD` | yes | Redis auth |
| `AUTH_SECRET` | yes | NextAuth secret |
| `NEXTAUTH_URL` | no | Public URL (default `http://localhost:3004`) |
| `DATABASE_URL` | dev only | Built by Compose for the container; set it yourself for local dev and Prisma CLI |
| `LLM_PROVIDER` | no | `ollama` (default) or `claude` |
| `OLLAMA_HOST` / `OLLAMA_MODEL` | no | Default `http://host.docker.internal:11434` / `qwen2.5:14b` |
| `CLAUDE_BRIDGE_URL` / `CLAUDE_BRIDGE_TOKEN` / `CLAUDE_MODEL` | no | LLM gateway URL, shared token, model alias |
| `CHANGE_MANAGER_API_URL` / `CHANGE_MANAGER_API_KEY` | no | External change-management system and its bearer token |
| `SEED_ADMIN_PASSWORD` | no | Seed admin password (random if unset) |
| `ENCRYPTION_KEY` | no | 64 hex chars, used by `src/lib/crypto.ts` |

## Tests

```bash
npm test                  # Vitest
npm run test:coverage
npm run typecheck
npm run lint
```

Parser tests (`tests/parsers/`) run against synthetic configs in `tests/fixtures/` for Palo Alto, Cisco ASA, Check Point, Fortinet and Juniper SRX. The fixtures use only RFC 5737 documentation addresses and `example.com` names. `tests/analysis/` covers the rule analysis engine.

## License

MIT, see [LICENSE](LICENSE).
