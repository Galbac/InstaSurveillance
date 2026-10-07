COMPOSE = docker compose --env-file .env.dev -f compose.dev.yml
PROD_ENV ?= /secure/path/.env.prod
PROD = docker compose --env-file $(PROD_ENV) -f compose.prod.yml
.PHONY: setup dev down logs migrate test check frontend-check schema performance backup-drill prod-build prod-config stack-smoke image-audit
setup:
	python3 deploy/scripts/setup-env.py
dev: setup
	$(COMPOSE) up --build -d
migrate:
	$(COMPOSE) run --rm migrate
logs:
	$(COMPOSE) logs -f --tail=50 backend worker auth-worker maintenance frontend
down:
	$(COMPOSE) down
test:
	$(COMPOSE) run --rm --no-deps -e TEST_POSTGRES_ENABLED=1 migrate pytest -q
check:
	$(COMPOSE) run --rm --no-deps backend sh -c 'poetry check --lock && ruff check app tests && ruff format --check app tests && pyright'
	python3 deploy/scripts/check-workspace.py
frontend-check:
	$(COMPOSE) run --rm --no-deps frontend sh -c 'npm run test && npm run lint && npm run typecheck && npm run build'
schema:
	$(COMPOSE) run --rm --no-deps -v "$(CURDIR)/docs/api:/reports" backend python -m app.schema --output /reports/openapi.json
	$(COMPOSE) run --rm --no-deps -v "$(CURDIR)/docs:/docs:ro" frontend npm run api:generate
performance:
	docker build --target verification -t instasurveillance-verification:local backend
	docker run --rm --network instasurveillance-dev_default --env-file .env.dev -e TEST_POSTGRES_ENABLED=1 -e RUN_PERFORMANCE=1 -e PERF_REPORT_PATH=/reports/performance-alpine.json -v "$(CURDIR)/docs/reports:/reports" instasurveillance-verification:local sh -c 'export DATABASE_URL="$$MIGRATION_DATABASE_URL"; pytest tests/test_performance.py -q' 
backup-drill:
	docker build --target backup -t instasurveillance-backup:local backend
	docker run --rm --user 0 --network instasurveillance-dev_default --env-file .env.dev -e PYTHONPATH=/app -e DRILL_REPORT_PATH=/reports/restore-drill.json -v "$(CURDIR)/deploy/scripts/verify-backup.py:/verify-backup.py:ro" -v "$(CURDIR)/docs/reports:/reports" instasurveillance-backup:local python /verify-backup.py
prod-build:
	docker build --target prod -t instasurveillance-backend:local backend
	docker build --target prod -t instasurveillance-frontend:local frontend
	docker build --target backup -t instasurveillance-backup:local backend
prod-config:
	$(PROD) config --quiet

stack-smoke:
	python3 deploy/scripts/verify-dev-stack.py
image-audit:
	./deploy/scripts/scan-images.sh local

.PHONY: clean-start
clean-start:
	python3 deploy/scripts/verify-clean-start.py

.PHONY: s3-drill
s3-drill:
	$(COMPOSE) up -d storage
	$(COMPOSE) run --rm --no-deps -e PYTHONPATH=/app -e STORAGE_BACKEND=s3 -e S3_ENDPOINT=http://storage:3900 -e S3_SERVER_SIDE_ENCRYPTION= -e S3_REPORT_PATH=/reports/s3-drill.json -v "$(CURDIR)/deploy/scripts/verify-s3.py:/verify-s3.py:ro" -v "$(CURDIR)/docs/reports:/reports" backend python /verify-s3.py
