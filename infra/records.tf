########################################################################
# Global records: DynamoDB + one Lambda + HTTP API. A copy of Räkkä's
# stack (docs/adr/0002-own-records-api.md) with floors in place of
# seconds. Idle cost is zero; see jeeves memory "serverless over standing
# servers". Reads come through the CloudFront cache (main.tf, /board), so
# only saved scores reach the Lambda.
########################################################################

resource "aws_dynamodb_table" "scores" {
  name         = "hoyry-scores"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
  attribute {
    name = "score"
    type = "N"
  }
  attribute {
    name = "day"
    type = "S"
  }
  attribute {
    name = "week"
    type = "S"
  }
  attribute {
    name = "month"
    type = "S"
  }
  attribute {
    name = "all"
    type = "S"
  }

  global_secondary_index {
    name            = "byDay"
    hash_key        = "day"
    range_key       = "score"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "byWeek"
    hash_key        = "week"
    range_key       = "score"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "byMonth"
    hash_key        = "month"
    range_key       = "score"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "byAll"
    hash_key        = "all"
    range_key       = "score"
    projection_type = "ALL"
  }
}

data "archive_file" "records" {
  type        = "zip"
  source_file = "${path.module}/records/index.mjs"
  output_path = "${path.module}/.records.zip"
}

resource "aws_iam_role" "records" {
  name = "hoyry-records-lambda"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "records" {
  role = aws_iam_role.records.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:Query", "dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = [aws_dynamodb_table.scores.arn, "${aws_dynamodb_table.scores.arn}/index/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_lambda_function" "records" {
  function_name    = "hoyry-records"
  role             = aws_iam_role.records.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.records.output_path
  source_code_hash = data.archive_file.records.output_base64sha256
  timeout          = 10
  memory_size      = 256
  environment {
    variables = { TABLE = aws_dynamodb_table.scores.name }
  }
}

resource "aws_cloudwatch_log_group" "records" {
  name              = "/aws/lambda/${aws_lambda_function.records.function_name}"
  retention_in_days = 14
}

resource "aws_apigatewayv2_api" "records" {
  name          = "hoyry-records"
  protocol_type = "HTTP"
  cors_configuration {
    # The game itself, local dev, and the two portals that will embed the
    # same build in an iframe (Räkkä's list: itch.io serves uploads from
    # html-classic.itch.zone, Newgrounds from uploads.ungrounded.net).
    allow_origins = ["https://vesahyp.github.io", "https://html-classic.itch.zone", "https://html.itch.zone", "https://uploads.ungrounded.net", "http://localhost:5173", "http://localhost:4173", "http://localhost:5197", "http://localhost:5199"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "records" {
  api_id                 = aws_apigatewayv2_api.records.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.records.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "board" {
  api_id    = aws_apigatewayv2_api.records.id
  route_key = "GET /board"
  target    = "integrations/${aws_apigatewayv2_integration.records.id}"
}

resource "aws_apigatewayv2_route" "scores" {
  api_id    = aws_apigatewayv2_api.records.id
  route_key = "POST /scores"
  target    = "integrations/${aws_apigatewayv2_integration.records.id}"
}

resource "aws_apigatewayv2_stage" "records" {
  api_id      = aws_apigatewayv2_api.records.id
  name        = "$default"
  auto_deploy = true
  # Reads come through the CloudFront cache (GET /board), so what reaches
  # the API is saved scores: one a run. The account's Lambda concurrency is
  # 10, shared by every project and not raised, so this cap is low: at
  # about 100 ms a call, ten a second holds one seat on average, and the
  # burst of twenty is a few seconds of a portal feature, after which the
  # API answers 429 and the game shows the local record instead.
  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
}

resource "aws_lambda_permission" "records" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.records.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.records.execution_arn}/*/*"
}

# The leaderboard as players read it: GET /board through the pixel
# distribution (main.tf), cached a minute per period and per Origin, so
# reads cost the same at any number of players.
resource "aws_cloudfront_cache_policy" "board" {
  name        = "hoyry-board-cache"
  comment     = "The origin's max-age (60 s), keyed on period and Origin"
  default_ttl = 60
  max_ttl     = 300
  min_ttl     = 0
  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config {
      cookie_behavior = "none"
    }
    # API Gateway answers CORS with the asking origin, so the origin is in
    # the key: a cached answer always carries the header for its asker.
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Origin"]
      }
    }
    query_strings_config {
      query_string_behavior = "whitelist"
      query_strings {
        items = ["period"]
      }
    }
  }
}

output "board_url" {
  description = "The cached leaderboard (VITE_BOARD_URL)."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}/board"
}

output "records_api" {
  description = "Base URL of the records API (VITE_RECORDS_API)."
  value       = aws_apigatewayv2_api.records.api_endpoint
}
