output "bucket_name" {
  description = "S3 bucket holding the pixel (later the site content)."
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "CloudFront distribution ID (invalidation target)."
  value       = aws_cloudfront_distribution.site.id
}

output "distribution_domain" {
  description = "CloudFront domain name — the tracker endpoint host until sceggle has a domain."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "pixel_url" {
  description = "Full tracking-pixel URL to bake into index.html's TRACKER_CONFIG."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}/t.gif"
}
