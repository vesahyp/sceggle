terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

# Default provider. S3 buckets live here.
provider "aws" {
  region  = var.region
  profile = var.aws_profile
}

# CloudFront requires its ACM certificate in us-east-1. Unused until the
# game gets a domain, but kept so adding the cert later is a diff, not a
# restructure.
provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile
}
