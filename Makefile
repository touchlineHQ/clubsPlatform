.PHONY: help worker worker-migrated ui ui-remote dev dev-full preview install install-ui db-migrate-local db-migrate-prod

help:
	@echo "Targets:"
	@echo "  make dev              Run full stack (migrates DB + Vite + Wrangler proxy at :$(WORKER_PORT))"
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
UI_DIR ?= website
UI_PORT ?= 5173
WORKER_PORT ?= 8788
PERSIST_DIR ?= .wrangler/state
API_TARGET ?= https://elbantams.pages.dev

install:
	@npm install --ignore-scripts
	@$(MAKE) install-ui

install-ui:
	@cd "$(UI_DIR)" && npm install

worker:
	@mkdir -p "$(PERSIST_DIR)"
	@npx wrangler pages dev \
		--port "$(WORKER_PORT)" \
		--persist-to "$(PERSIST_DIR)"

# Ensure local DB is migrated before running worker
worker-migrated: db-migrate-local worker

ui:
	@cd "$(UI_DIR)" && npm run dev -- --port "$(UI_PORT)"

ui-remote:
	@cd "$(UI_DIR)" && API_TARGET="$(API_TARGET)" npm run dev -- --port "$(UI_PORT)"

# Full stack: Vite in background, Wrangler proxies to it.
# Access app at http://localhost:$(WORKER_PORT). Ctrl+C stops both.
dev:
	@$(MAKE) db-migrate-local
	@cd "$(UI_DIR)" && npm run dev -- --port "$(UI_PORT)" & \
	VITE_PID=$$!; \
	trap "kill $$VITE_PID 2>/dev/null" EXIT INT TERM; \
	echo "Waiting for Vite on port $(UI_PORT)..."; \
	until curl -sf "http://localhost:$(UI_PORT)" > /dev/null 2>&1; do sleep 0.5; done; \
	echo "Vite ready — starting Wrangler (access full stack at http://localhost:$(WORKER_PORT))"; \
	npx wrangler pages dev \
		--port "$(WORKER_PORT)" \
		--proxy "$(UI_PORT)" \
		--persist-to "$(PERSIST_DIR)"

preview:
	@npx wrangler pages dev "$(UI_DIR)/dist"

db-migrate-local:
	@npx wrangler d1 migrations apply elbantams-auth --local

db-migrate-prod:
	@npx wrangler d1 migrations apply elbantams-auth --remote
