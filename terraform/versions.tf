terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

# `lstk terraform` points this provider at LocalStack. Run plain `terraform`
# with real credentials and `-var localstack=false` to deploy to AWS.
provider "aws" {
  region = var.aws_region
}
