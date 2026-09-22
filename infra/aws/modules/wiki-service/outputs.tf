output "module_version" {
  description = "Version of this independently released infrastructure module contract. Pin the module source separately from the application image."
  value       = local.module_version
}

output "service_name" {
  description = "Exact ECS service name owned by this module."
  value       = aws_ecs_service.this.name
}

output "service_arn" {
  description = "Exact ECS service ARN owned by this module."
  value       = aws_ecs_service.this.arn
}

output "task_definition_arn" {
  description = "Exact retained ECS task-definition revision selected by the service."
  value       = aws_ecs_task_definition.this.arn
}

output "task_definition_family" {
  description = "ECS task-definition family whose old revisions remain registered for inspected rollback."
  value       = aws_ecs_task_definition.this.family
}

output "image_uri" {
  description = "Exact immutable application image selected by this module instance."
  value       = var.image_uri
}

output "application_version" {
  description = "Application release identity selected independently from module_version."
  value       = var.application_version
}

output "security_group_id" {
  description = "Service task security group. Caller-owned ingress should target this group through the module input."
  value       = aws_security_group.this.id
}

output "data_access_point_id" {
  description = "S3 Files access point that enforces UID/GID 65532 at the independent /data root."
  value       = aws_s3files_access_point.data.id
}

output "data_access_point_arn" {
  description = "S3 Files access point ARN mounted by the task definition."
  value       = aws_s3files_access_point.data.arn
}

output "task_role_arn" {
  description = "Runtime role scoped to this installation's S3 Files access point and object prefix."
  value       = aws_iam_role.task.arn
}

output "execution_role_arn" {
  description = "Execution role scoped to this service's logs, declared secret references, KMS keys, and ECR repositories."
  value       = aws_iam_role.execution.arn
}

output "log_group_name" {
  description = "CloudWatch log group for the serving task. Bootstrap credentials must not be emitted here."
  value       = aws_cloudwatch_log_group.this.name
}

output "health" {
  description = "Health contract to configure and verify through the caller-owned HTTPS ingress."
  value = {
    liveness_path           = "/healthz"
    authenticated_readiness = "/api/articles/health.json"
    container_port          = var.container_port
    canonical_https_origin  = var.origin
  }
}

output "release" {
  description = "Exact independently selected module, application, image, task, and service identities for deployment receipts."
  value = {
    module_version      = local.module_version
    application_version = var.application_version
    activation_receipt  = var.activation_receipt_sha256
    image_uri           = var.image_uri
    task_definition_arn = aws_ecs_task_definition.this.arn
    service_name        = aws_ecs_service.this.name
    service_arn         = aws_ecs_service.this.arn
  }
}
