variable "region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "cluster_arn" {
  type = string
}

variable "target_group_arn" {
  type = string
}

variable "ingress_security_group_id" {
  type = string
}

variable "s3_files_file_system_id" {
  type = string
}

variable "s3_files_file_system_arn" {
  type = string
}

variable "s3_files_bucket_arn" {
  type = string
}

variable "image_uri" {
  type = string
}

variable "activation_receipt_sha256" {
  type     = string
  default  = null
  nullable = true
}
