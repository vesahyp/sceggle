# Sceggle — dev, pixel infra, and pixel deploy.
# The game itself deploys to GitHub Pages via .github/workflows/deploy.yml
# on every push to master; this Makefile manages the analytics pixel host
# (S3/CloudFront/logs, Terraform under infra/) — the pattern lifted from
# tienoo. When sceggle gets its own domain, site hosting moves here too.
#
#   make dev           # vite dev server
#   make build         # production build -> dist/
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

.PHONY: dev build preview plan apply outputs deploy-pixel

dev:
	npm run dev

build:
	npm run build

preview: build
	npm run preview

plan:
	$(TF) init -upgrade
	$(TF) plan -out=tfplan

apply:
	$(TF) apply tfplan
	@echo
	@echo "Pixel endpoint (bake into index.html's TRACKER_CONFIG):"
	@$(TF) output -raw pixel_url; echo

outputs:
	@$(TF) output

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
