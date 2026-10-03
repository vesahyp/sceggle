# Höyry: dev, checks, screenshots. The game deploys from GitHub Actions on
# every push to master; infra/ here is the analytics pixel host (and,
# later, the site itself), the one thing this Makefile deploys.
#
#   make dev           # vite dev server
#   make build         # production build -> dist/
#   make preview       # build, then serve it locally
#   make check         # typecheck + build + sim-check, what a commit needs green
#   make balance       # bot runs, one line per run (FLOORS ?= 10 RUNS ?= 2 HERO ?=)
#   make shots-setup   # once: install Playwright
#   make shots         # phone screenshots into shots/
#   make shots-en      # the same in English, into shots/en/
#   make touch-check   # taps through the menus on an emulated phone
#   make plan          # terraform plan for the pixel infra (no changes)
#   make apply         # terraform apply (creates AWS resources)
#   make outputs       # show terraform outputs (pixel_url etc.)
#   make deploy-pixel  # upload t.gif to the pixel bucket
#
# AWS profile: default credential chain; pass PROFILE=name to override.

PROFILE ?=
PROF     = $(if $(PROFILE),AWS_PROFILE=$(PROFILE) ,)
AWS      = $(PROF)aws
TF       = $(PROF)terraform -chdir=infra

.PHONY: touch-check dev build preview check balance shots-setup shots shots-en plan apply outputs deploy-pixel

dev:
	npm run dev

build:
	npm run build

preview: build
	npm run preview

check:
	npm run typecheck
	npm run build
	npm run sim-check

FLOORS ?= 10
RUNS ?= 2
HERO ?=
balance:
	npm run balance -- $(FLOORS) $(RUNS) $(HERO)

shots-setup:
	npm install --no-save playwright && npx playwright install chromium

shots:
	node scripts/shots.mjs

touch-check:
	node scripts/touch-check.mjs

shots-en:
	node scripts/shots.mjs en

plan:
	$(TF) init
	$(TF) plan -out=tfplan

apply:
	$(TF) apply tfplan
	$(MAKE) env

outputs:
	@$(TF) output

# The pixel URL for builds on this machine, from the Terraform output.
# Gitignored (*.local): a clone without it builds a game whose tracker is
# off, which is what a fork should get. The Pages deploy reads the same
# value from a GitHub repository variable.
env:
	@printf 'VITE_PIXEL_URL=%s\n' "$$($(TF) output -raw pixel_url)" > .env.local
	@cat .env.local

# The pixel must never cache: every beacon has to reach the origin so the
# request (and its query string) lands in the CloudFront access logs.
deploy-pixel:
	@BUCKET=$$($(TF) output -raw bucket_name); \
	DIST=$$($(TF) output -raw distribution_id); \
	echo "→ uploading t.gif to s3://$$BUCKET (no-store)"; \
	$(AWS) s3 cp public/t.gif "s3://$$BUCKET/t.gif" \
	  --cache-control "no-store" --content-type "image/gif"; \
	$(AWS) cloudfront create-invalidation --distribution-id "$$DIST" --paths "/t.gif" >/dev/null; \
	echo "✓ pixel live at $$($(TF) output -raw pixel_url)"
