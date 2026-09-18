resource "aws_dynamodb_table" "claims" {
  name         = "${var.app_name}-claims"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}
