variable "aws_region" {
  description = "Region for every resource."
  type        = string
  default     = "us-east-1"
}

variable "app_name" {
  description = "Prefix for resource names."
  type        = string
  default     = "expenses"
}

variable "localstack" {
  description = "true when deploying to LocalStack. Controls the token issuer URL the API's JWT authorizer trusts."
  type        = bool
  default     = true
}

variable "localstack_host" {
  description = "Host and port LocalStack is reachable on from the browser (matches LOCALSTACK_HOST)."
  type        = string
  default     = "localhost.localstack.cloud:4566"
}

variable "spa_origin" {
  description = "Origin of the Vite dev server. Used for OAuth callback URLs and API CORS."
  type        = string
  default     = "http://localhost:5173"
}

variable "cognito_domain_prefix" {
  description = "Hosted UI domain prefix. Must be globally unique on AWS; LocalStack accepts anything."
  type        = string
  default     = "expenses-portal-local"
}
