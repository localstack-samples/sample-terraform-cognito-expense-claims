SHELL := /bin/bash
SPA_ORIGIN ?= http://localhost:5173

usage:              ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-16s\033[0m %s\n", $$1, $$2}'

check:              ## Check that docker, lstk, node and terraform are installed
	@command -v docker    >/dev/null || (echo "docker not found";    exit 1)
	@command -v lstk      >/dev/null || (echo "lstk not found: https://docs.localstack.cloud/aws/developer-tools/running-localstack/lstk/"; exit 1)
	@command -v node      >/dev/null || (echo "node not found";      exit 1)
	@command -v terraform >/dev/null || (echo "terraform not found"; exit 1)
	@node -e 'const [maj,min]=process.versions.node.split(".").map(Number); if (maj<22||(maj===22&&min<12)) { console.error("Node 22.12+ required, found "+process.version); process.exit(1) }'
	@echo "All tools present."

install:            ## Install npm dependencies
	npm install

start:              ## Start LocalStack with the SPA origin allowed for CORS
	LOCALSTACK_EXTRA_CORS_ALLOWED_ORIGINS=$(SPA_ORIGIN) lstk start

build:              ## Bundle the Lambda function
	npm run build:api

deploy: build       ## Deploy everything with Terraform and write the env files
	cd terraform && lstk terraform init -input=false && lstk terraform apply -auto-approve -input=false
	npm run configure

dev:                ## Run the SPA on http://localhost:5173
	npm run dev

export:             ## Run the payroll export (client_credentials)
	npm run payroll-export

test:               ## Run the integration test against the deployed stack
	npm test

destroy:            ## Destroy the Terraform resources
	cd terraform && lstk terraform destroy -auto-approve -input=false

stop:               ## Stop LocalStack
	lstk stop

.PHONY: usage check install start build deploy dev export test destroy stop
