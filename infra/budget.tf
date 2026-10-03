# The wallet alarm for hoyry (rakka/infra/budget.tf is the shape): every
# cost tagged project=hoyry, which is the pixel distribution, the logs and
# the records API. Normal months are cents. The alarm emails and pushes to
# the phone; the response is a human looking at Cost Explorer grouped by
# tag:project.

variable "budget_alert_email" {
  description = "Where the hoyry budget notifications go."
  type        = string
  default     = "vesa.hypponen@gmail.com"
}

variable "hoyry_monthly_budget_usd" {
  description = "Monthly hoyry spend, in USD, that counts as a surprise."
  type        = string
  default     = "20"
}

resource "aws_budgets_budget" "hoyry" {
  name         = "hoyry-monthly"
  budget_type  = "COST"
  limit_amount = var.hoyry_monthly_budget_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:project$hoyry"]
  }

  # The forecast warns while there is still time to act; the two actuals
  # say it happened.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
    subscriber_sns_topic_arns  = [data.aws_sns_topic.jeeves_push.arn]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
    subscriber_sns_topic_arns  = [data.aws_sns_topic.jeeves_push.arn]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
    subscriber_sns_topic_arns  = [data.aws_sns_topic.jeeves_push.arn]
  }
}

# jeeves-push (jeeves/infra/alarmpush.tf) sends the same notification to
# the phone. Read by name, so jeeves must be applied first.
data "aws_sns_topic" "jeeves_push" {
  name = "jeeves-push"
}
