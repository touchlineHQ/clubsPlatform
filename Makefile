.PHONY: help worker worker-migrated ui ui-remote dev dev-full preview install install-ui db-migrate-local db-migrate-prod

help:
	@echo "Targets:"
	@echo "  make dev              Run full stack (migrates DB + Wrangler API + Vite at :$(UI_PORT))"
	@echo "  make worker          Run wrangler API only"
	@echo "  make worker-migrated Run worker after migrating local DB"
	@echo "  make ui              Run Vite UI only"
	@echo "  make ui-remote       Run UI with remote API"
	@echo "  make preview         Preview built Pages output"
	@echo "  make install         Install deps (root + UI)"
	@echo "  make install-ui      Install UI deps only"
	@echo "  make db-migrate-local  Apply migrations to local D1"
	@echo "  make db-migrate-prod   Apply migrations to production D1"
	@echo ""
	@echo "Vars:"
	@echo "  UI_PORT=5173     Vite dev server port (default)"
	@echo "  WORKER_PORT=8788 Wrangler dev port (default)"

# Config
D1_BINDING ?= DB
# `wrangler pages dev` rejects --env and only ever reads the TOP-LEVEL
# wrangler.toml, which deliberately defines no d1_databases so that every deploy
# has to name an environment-scoped database explicitly. That means the binding
# has to be supplied on the command line here, or the Pages Functions get no DB
# and every route throws in ensureTables — with the 500s swallowed by the
# try/catch paths in website/src/data.ts, so the site renders and the API is
# simply dead.
#
# Wrangler keys local D1 storage by this id, which is what makes the migrate and
# serve targets below talk to the same file. Keep it equal to
# [env.production].d1_databases.database_id in wrangler.toml. Nothing here can
# reach the real database: `wrangler pages dev` has no remote mode for D1.
# (The e2e scripts in package.json use the preview id for the same reason, so a
# test run cannot wipe a local dev database. See the README.)
# Not configurable: local migrations use the production id from wrangler.toml.
override D1_DATABASE_ID := 65a7e9d9-3772-4471-af13-fd2e39ab8f90
UI_DIR ?= website
UI_PORT ?= 5173
WORKER_PORT ?= 8788
PERSIST_DIR ?= .wrangler/state
API_TARGET ?= https://clubs.touchlinehq.co.uk

install:
	@npm install --ignore-scripts
	@$(MAKE) install-ui

install-ui:
	@cd "$(UI_DIR)" && npm install

worker:
	@mkdir -p "$(PERSIST_DIR)"
	@npx wrangler pages dev "$(UI_DIR)/public" \
		--port "$(WORKER_PORT)" \
		--persist-to "$(PERSIST_DIR)" \
		--d1 "$(D1_BINDING)=$(D1_DATABASE_ID)"

# Ensure local DB is migrated before running worker
worker-migrated: db-migrate-local worker

ui:
	@cd "$(UI_DIR)" && npm run dev -- --port "$(UI_PORT)"

ui-remote:
	@cd "$(UI_DIR)" && API_TARGET="$(API_TARGET)" npm run dev -- --port "$(UI_PORT)"

# Full stack: Wrangler API in background, Vite proxies /api to it.
# Access app at http://localhost:$(UI_PORT). Ctrl+C stops both.
dev:
	@$(MAKE) db-migrate-local
	@mkdir -p "$(PERSIST_DIR)"; \
	npx wrangler pages dev "$(UI_DIR)/public" \
		--port "$(WORKER_PORT)" \
		--persist-to "$(PERSIST_DIR)" \
		--d1 "$(D1_BINDING)=$(D1_DATABASE_ID)" & \
	WRANGLER_PID=$$!; \
	trap "kill $$WRANGLER_PID 2>/dev/null" EXIT INT TERM; \
	echo "Waiting for Wrangler on port $(WORKER_PORT)..."; \
	until bash -c "echo > /dev/tcp/localhost/$(WORKER_PORT)" 2>/dev/null; do sleep 0.5; done; \
	echo "Wrangler ready — starting Vite (access app at http://localhost:$(UI_PORT))"; \
	cd "$(UI_DIR)" && npm run dev -- --port "$(UI_PORT)"

preview:
	@npx wrangler pages dev "$(UI_DIR)/dist" \
		--persist-to "$(PERSIST_DIR)" \
		--d1 "$(D1_BINDING)=$(D1_DATABASE_ID)"

# --env production is required, not cosmetic: without it wrangler looks for the
# database in the top-level d1_databases (empty by design) and fails with
# "Couldn't find a D1 DB with the name or binding 'clubsplatform-auth'". Because
# make aborts on that, it also took `dev` and `worker-migrated` down with it.
db-migrate-local:
	@npx wrangler d1 migrations apply clubsplatform-auth --local --env production \
		--persist-to "$(PERSIST_DIR)"

db-migrate-prod:
	@npx wrangler d1 migrations apply clubsplatform-auth --remote --env production
