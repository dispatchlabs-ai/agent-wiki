variable "name" {
  description = "Stable lowercase name for this independent Wiki installation."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,37}$", var.name))
    error_message = "name must contain 3-38 lowercase letters, numbers, or hyphens and start with a letter."
  }
}

variable "vpc_id" {
  description = "Caller-owned VPC in which the Wiki service runs."
  type        = string
}

variable "subnet_ids" {
  description = "Caller-owned private subnets used by the Fargate service."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "subnet_ids must contain at least two subnets."
  }
}

variable "cluster_arn" {
  description = "ARN of the caller-owned ECS cluster."
  type        = string
}

variable "target_group_arn" {
  description = "ARN of the caller-owned HTTP target group behind the HTTPS ingress. Configure its health check for /healthz."
  type        = string
}

variable "ingress_security_group_ids" {
  description = "Caller-owned security groups allowed to reach the Wiki container port, normally the HTTPS ingress security group."
  type        = set(string)

  validation {
    condition     = length(var.ingress_security_group_ids) > 0
    error_message = "ingress_security_group_ids must name at least one caller-owned ingress security group."
  }
}

variable "assign_public_ip" {
  description = "Assign a public address to the task ENI. Private subnets with controlled egress are the default."
  type        = bool
  default     = false
}

variable "origin" {
  description = "Canonical private HTTPS origin used for Host, cookie, and callback checks."
  type        = string

  validation {
    condition     = can(regex("^https://[A-Za-z0-9.-]+(:[0-9]+)?$", var.origin))
    error_message = "origin must be an HTTPS origin without a path, query, fragment, or trailing slash."
  }
}

variable "image_uri" {
  description = "Immutable x86_64 Linux Agent Wiki image reference pinned by a full sha256 digest."
  type        = string

  validation {
    condition     = can(regex("^[^[:space:]]+@sha256:[0-9a-f]{64}$", var.image_uri))
    error_message = "image_uri must end in @sha256:<64 lowercase hexadecimal characters>."
  }
}

variable "application_version" {
  description = "Agent Wiki release identity corresponding to image_uri. This is independent of the module source version."
  type        = string

  validation {
    condition     = trimspace(var.application_version) == var.application_version && var.application_version != ""
    error_message = "application_version must be a nonempty trimmed release identity."
  }
}

variable "desired_count" {
  description = "Serving owner count. Keep zero through bootstrap and every exclusive lifecycle operation; one is the only active state."
  type        = number
  default     = 0

  validation {
    condition     = contains([0, 1], var.desired_count)
    error_message = "desired_count must be 0 or 1 because the managed Wiki root has one writer."
  }
}

variable "activation_receipt_sha256" {
  description = "Digest of the non-secret operator receipt proving initialization or stop/quiescence checks for the selected image. Required before desired_count becomes one."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.activation_receipt_sha256 == null || can(regex("^[0-9a-f]{64}$", var.activation_receipt_sha256))
    error_message = "activation_receipt_sha256 must be null or 64 lowercase hexadecimal characters."
  }
}

variable "s3_files_file_system_id" {
  description = "ID of the caller-owned S3 Files filesystem."
  type        = string
}

variable "s3_files_file_system_arn" {
  description = "ARN of the caller-owned S3 Files filesystem."
  type        = string
}

variable "s3_files_bucket_arn" {
  description = "ARN of the caller-owned authoritative S3 bucket behind the filesystem."
  type        = string

  validation {
    condition     = can(regex("^arn:[^:]+:s3:::[a-z0-9][a-z0-9.-]+$", var.s3_files_bucket_arn))
    error_message = "s3_files_bucket_arn must be a general-purpose S3 bucket ARN."
  }
}

variable "s3_files_prefix" {
  description = "Caller-owned bucket prefix exposed as the S3 Files filesystem root."
  type        = string

  validation {
    condition = (
      var.s3_files_prefix != "" &&
      !startswith(var.s3_files_prefix, "/") &&
      endswith(var.s3_files_prefix, "/") &&
      !strcontains(var.s3_files_prefix, "//") &&
      !strcontains(var.s3_files_prefix, "..") &&
      trimspace(var.s3_files_prefix) == var.s3_files_prefix
    )
    error_message = "s3_files_prefix must be a nonempty relative prefix ending in /, without whitespace, //, or .. components."
  }
}

variable "container_port" {
  description = "Unencrypted HTTP port used between the caller-owned ingress and Wiki task."
  type        = number
  default     = 4317

  validation {
    condition     = var.container_port >= 1024 && var.container_port <= 65535
    error_message = "container_port must be an unprivileged TCP port."
  }
}

variable "cpu" {
  description = "Fargate CPU units reserved for the Wiki task."
  type        = number
  default     = 512

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096], var.cpu)
    error_message = "cpu must be one of the bounded Fargate CPU sizes from 256 through 4096 units."
  }
}

variable "memory" {
  description = "Fargate memory in MiB reserved for the Wiki task."
  type        = number
  default     = 2048

  validation {
    condition     = var.memory >= 512 && var.memory <= 30720 && floor(var.memory) == var.memory
    error_message = "memory must be an integer between 512 and 30720 MiB."
  }
}

variable "ephemeral_storage_gib" {
  description = "Ephemeral task storage, including the Fargate-provided 20 GiB baseline. Durable Wiki state remains on /data."
  type        = number
  default     = 20

  validation {
    condition     = var.ephemeral_storage_gib >= 20 && var.ephemeral_storage_gib <= 200 && floor(var.ephemeral_storage_gib) == var.ephemeral_storage_gib
    error_message = "ephemeral_storage_gib must be an integer between 20 and 200."
  }
}

variable "stop_timeout_seconds" {
  description = "Grace period for the managed owner to stop before ECS sends SIGKILL."
  type        = number
  default     = 120

  validation {
    condition     = var.stop_timeout_seconds >= 30 && var.stop_timeout_seconds <= 120
    error_message = "stop_timeout_seconds must be between 30 and 120."
  }
}

variable "health_check_grace_period_seconds" {
  description = "Startup grace period before the caller-owned target group health check can replace the task."
  type        = number
  default     = 60

  validation {
    condition     = var.health_check_grace_period_seconds >= 0 && var.health_check_grace_period_seconds <= 900
    error_message = "health_check_grace_period_seconds must be between 0 and 900."
  }
}

variable "environment" {
  description = "Non-secret application configuration. PORT, WIKI_LISTEN_HOST, WIKI_ORIGIN, HOME, and NODE_ENV are module-owned."
  type        = map(string)
  default     = {}
}

variable "secret_environment" {
  description = "Environment variable names mapped to exact Secrets Manager secret or SSM parameter ARNs. Secret values never enter OpenTofu state."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for arn in values(var.secret_environment) : (
        can(regex("^arn:[^:*?]+:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$", arn)) ||
        can(regex("^arn:[^:*?]+:ssm:[a-z0-9-]+:[0-9]{12}:parameter/[A-Za-z0-9_./-]+$", arn))
      )
    ])
    error_message = "secret_environment values must be exact Secrets Manager secret or SSM parameter ARNs."
  }
}

variable "secret_kms_key_arns" {
  description = "Exact customer-managed KMS key ARNs needed to decrypt declared secret references."
  type        = set(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.secret_kms_key_arns : can(regex("^arn:[^:*?]+:kms:[a-z0-9-]+:[0-9]{12}:key/[0-9a-f-]+$", arn))
    ])
    error_message = "secret_kms_key_arns must contain exact KMS key ARNs without wildcards."
  }
}

variable "ecr_repository_arns" {
  description = "Exact private ECR repository ARNs from which the execution role may pull image_uri. Leave empty for a public registry."
  type        = set(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.ecr_repository_arns : can(regex("^arn:[^:*?]+:ecr:[a-z0-9-]+:[0-9]{12}:repository/[A-Za-z0-9_./-]+$", arn))
    ])
    error_message = "ecr_repository_arns must contain exact ECR repository ARNs without wildcards."
  }
}

variable "log_retention_days" {
  description = "CloudWatch log retention for this Wiki service."
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "log_retention_days must be a CloudWatch Logs supported retention value."
  }
}

variable "log_kms_key_arn" {
  description = "Optional caller-owned KMS key used to encrypt this module's CloudWatch log group."
  type        = string
  default     = null
  nullable    = true
}

variable "tags" {
  description = "Additional tags for module-owned resources."
  type        = map(string)
  default     = {}
}
