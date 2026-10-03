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
#   make board-check   # the leaderboard end to end (BASE=https://... checks the live game)
#   make plan          # terraform plan for infra/: the pixel host and the records API
#   make apply         # terraform apply, then make env
#   make env           # write .env.local from the Terraform outputs
#   make outputs       # show terraform outputs (pixel_url, records_api, board_url)
#   make deploy-pixel  # upload t.gif to the pixel bucket
#
# AWS profile: default credential chain; pass PROFILE=name to override.

PROFILE ?=
PROF     = $(if $(PROFILE),AWS_PROFILE=$(PROFILE) ,)
AWS      = $(PROF)aws
TF       = $(PROF)terraform -chdir=infra

.PHONY: env board-check touch-check dev build preview check balance shots-setup shots shots-en plan apply outputs deploy-pixel

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

BASE ?=
board-check:
	node scripts/board-check.mjs $(BASE)

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

# The back end for builds on this machine, written from the Terraform
# outputs. Gitignored (*.local): a clone without it builds a game with no
# tracker and no global records, which is what a fork should get. The
# Pages deploy reads the same values from GitHub repository variables.
env:
	@{ for o in pixel_url records_api board_url; do \
	     printf 'VITE_%s=%s\n' "$$(echo $$o | tr a-z A-Z)" "$$($(TF) output -raw $$o)"; done; } > .env.local
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
