module "wiki" {
  source = "../../modules/wiki-service"

  name                       = "example-company"
  vpc_id                     = var.vpc_id
  subnet_ids                 = var.subnet_ids
  cluster_arn                = var.cluster_arn
  target_group_arn           = var.target_group_arn
  ingress_security_group_ids = [var.ingress_security_group_id]

  origin              = "https://wiki.example.com"
  image_uri           = var.image_uri
  application_version = "0.8.8"

  s3_files_file_system_id  = var.s3_files_file_system_id
  s3_files_file_system_arn = var.s3_files_file_system_arn
  s3_files_bucket_arn      = var.s3_files_bucket_arn
  s3_files_prefix          = "agent-wiki/"

  # First apply with zero. After the managed one-off bootstrap and its receipt,
  # set this to one and provide only the receipt's SHA-256 digest.
  desired_count             = var.activation_receipt_sha256 == null ? 0 : 1
  activation_receipt_sha256 = var.activation_receipt_sha256

  environment = {
    WIKI_WRITE = "1"
  }

  # This value is an external reference. The secret value never enters HCL or state.
  secret_environment = {
    WIKI_AGENT_TOKEN_KEY = "arn:aws:ssm:us-east-1:123456789012:parameter/example-company/wiki/agent-token-key"
  }

  tags = {
    Application  = "agent-wiki"
    Installation = "example-company"
  }
}

output "wiki_release" {
  value = module.wiki.release
}
