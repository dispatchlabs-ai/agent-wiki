locals {
  module_version = "0.1.0"
  container_name = "agent-wiki"
  data_root      = "/wiki/${var.name}/data"
  data_prefix    = "${var.s3_files_prefix}${trimprefix(local.data_root, "/")}/"
  reserved_environment = {
    HOME             = "/tmp"
    NODE_ENV         = "production"
    PORT             = tostring(var.container_port)
    WIKI_LISTEN_HOST = "0.0.0.0"
    WIKI_ORIGIN      = var.origin
  }
  secretsmanager_secret_arns = sort(distinct([
    for arn in values(var.secret_environment) : arn if strcontains(arn, ":secretsmanager:")
  ]))
  ssm_parameter_arns = sort(distinct([
    for arn in values(var.secret_environment) : arn if strcontains(arn, ":ssm:")
  ]))
  fargate_cpu_memory_valid = (
    (var.cpu == 256 && contains([512, 1024, 2048], var.memory)) ||
    (var.cpu == 512 && contains([1024, 2048, 3072, 4096], var.memory)) ||
    (var.cpu == 1024 && var.memory >= 2048 && var.memory <= 8192 && var.memory % 1024 == 0) ||
    (var.cpu == 2048 && var.memory >= 4096 && var.memory <= 16384 && var.memory % 1024 == 0) ||
    (var.cpu == 4096 && var.memory >= 8192 && var.memory <= 30720 && var.memory % 1024 == 0)
  )
  common_tags = merge(var.tags, {
    Name                        = var.name
    "agent-wiki/component"      = "service"
    "agent-wiki/data-owner"     = "single-writer"
    "agent-wiki/module-version" = local.module_version
  })
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/agent-wiki/${var.name}/service"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.log_kms_key_arn

  tags = local.common_tags
}

resource "aws_security_group" "this" {
  name_prefix = "${var.name}-wiki-"
  description = "Agent Wiki HTTP ingress and controlled task egress."
  vpc_id      = var.vpc_id

  dynamic "ingress" {
    for_each = var.ingress_security_group_ids

    content {
      description     = "HTTP from caller-owned HTTPS ingress"
      from_port       = var.container_port
      to_port         = var.container_port
      protocol        = "tcp"
      security_groups = [ingress.value]
    }
  }

  egress {
    description = "Application, registry, logs, secrets, and S3 Files traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${var.name}-wiki-task"
  })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_s3files_access_point" "data" {
  file_system_id = var.s3_files_file_system_id

  posix_user {
    uid = 65532
    gid = 65532
  }

  root_directory {
    path = local.data_root

    creation_permissions {
      owner_uid   = 65532
      owner_gid   = 65532
      permissions = "0700"
    }
  }

  tags = merge(local.common_tags, {
    Name = "${var.name}-wiki-data"
  })
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task" {
  name_prefix        = "${var.name}-wiki-task-"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "task" {
  statement {
    sid    = "MountWikiDataAccessPoint"
    effect = "Allow"
    actions = [
      "s3files:ClientMount",
      "s3files:ClientWrite",
    ]
    resources = [var.s3_files_file_system_arn]

    condition {
      test     = "StringEquals"
      variable = "s3files:AccessPointArn"
      values   = [aws_s3files_access_point.data.arn]
    }
  }

  statement {
    sid    = "ReadWikiDataObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = ["${var.s3_files_bucket_arn}/${local.data_prefix}*"]
  }

  statement {
    sid       = "ListWikiDataObjects"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [var.s3_files_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        trimsuffix(local.data_prefix, "/"),
        "${local.data_prefix}*",
      ]
    }
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "wiki-data-access"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

resource "aws_iam_role" "execution" {
  name_prefix        = "${var.name}-wiki-exec-"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid    = "WriteServiceLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }

  dynamic "statement" {
    for_each = length(var.ecr_repository_arns) > 0 ? [true] : []

    content {
      sid       = "AuthenticateToEcr"
      effect    = "Allow"
      actions   = ["ecr:GetAuthorizationToken"]
      resources = ["*"]
    }
  }

  dynamic "statement" {
    for_each = length(var.ecr_repository_arns) > 0 ? [true] : []

    content {
      sid    = "PullDeclaredImageRepositories"
      effect = "Allow"
      actions = [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
      ]
      resources = sort(tolist(var.ecr_repository_arns))
    }
  }

  dynamic "statement" {
    for_each = length(local.secretsmanager_secret_arns) > 0 ? [true] : []

    content {
      sid       = "ReadDeclaredSecrets"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = local.secretsmanager_secret_arns
    }
  }

  dynamic "statement" {
    for_each = length(local.ssm_parameter_arns) > 0 ? [true] : []

    content {
      sid       = "ReadDeclaredParameters"
      effect    = "Allow"
      actions   = ["ssm:GetParameters"]
      resources = local.ssm_parameter_arns
    }
  }

  dynamic "statement" {
    for_each = length(var.secret_kms_key_arns) > 0 ? [true] : []

    content {
      sid       = "DecryptDeclaredSecretKeys"
      effect    = "Allow"
      actions   = ["kms:Decrypt"]
      resources = sort(tolist(var.secret_kms_key_arns))
    }
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "wiki-task-execution"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

locals {
  container_definition = {
    name                   = local.container_name
    image                  = var.image_uri
    essential              = true
    user                   = "65532:65532"
    readonlyRootFilesystem = true
    workingDirectory       = "/data"
    portMappings = [{
      name          = "http"
      containerPort = var.container_port
      hostPort      = var.container_port
      protocol      = "tcp"
      appProtocol   = "http"
    }]
    linuxParameters = {
      initProcessEnabled = true
      capabilities = {
        add  = []
        drop = ["ALL"]
      }
    }
    mountPoints = [
      {
        sourceVolume  = "data"
        containerPath = "/data"
        readOnly      = false
      },
      {
        sourceVolume  = "tmp"
        containerPath = "/tmp"
        readOnly      = false
      },
    ]
    environment = [
      for name in sort(keys(merge(var.environment, local.reserved_environment))) : {
        name  = name
        value = merge(var.environment, local.reserved_environment)[name]
      }
    ]
    secrets = [
      for name in sort(keys(var.secret_environment)) : {
        name      = name
        valueFrom = var.secret_environment[name]
      }
    ]
    command = [
      "serve",
      "--root",
      "/data",
      "--bind",
      "0.0.0.0",
      "--origin",
      var.origin,
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this.name
        awslogs-region        = aws_cloudwatch_log_group.this.region
        awslogs-stream-prefix = "service"
      }
    }
    stopTimeout = var.stop_timeout_seconds
  }
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name}-wiki"
  task_role_arn            = aws_iam_role.task.arn
  execution_role_arn       = aws_iam_role.execution.arn
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  container_definitions    = jsonencode([local.container_definition])
  skip_destroy             = true

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  dynamic "ephemeral_storage" {
    for_each = var.ephemeral_storage_gib > 20 ? [var.ephemeral_storage_gib] : []

    content {
      size_in_gib = ephemeral_storage.value
    }
  }

  volume {
    name = "data"

    s3files_volume_configuration {
      file_system_arn  = var.s3_files_file_system_arn
      access_point_arn = aws_s3files_access_point.data.arn
      root_directory   = "/"
    }
  }

  volume {
    name = "tmp"
  }

  tags = merge(local.common_tags, {
    "agent-wiki/application-version" = var.application_version
    "agent-wiki/activation-receipt"  = coalesce(var.activation_receipt_sha256, "not-activated")
    "agent-wiki/image-digest"        = split("@", var.image_uri)[1]
  })

  lifecycle {
    precondition {
      condition     = local.fargate_cpu_memory_valid
      error_message = "The selected cpu and memory values are not a valid bounded AWS Fargate combination."
    }

    precondition {
      condition     = length(setintersection(toset(keys(var.environment)), toset(keys(local.reserved_environment)))) == 0
      error_message = "environment must not override module-owned PORT, WIKI_LISTEN_HOST, WIKI_ORIGIN, HOME, or NODE_ENV."
    }

    precondition {
      condition     = length(setintersection(toset(keys(var.environment)), toset(keys(var.secret_environment)))) == 0
      error_message = "A configuration name cannot appear in both environment and secret_environment."
    }

    precondition {
      condition     = length(setintersection(toset(keys(local.reserved_environment)), toset(keys(var.secret_environment)))) == 0
      error_message = "secret_environment must not replace module-owned runtime settings."
    }
  }
}

resource "aws_ecs_service" "this" {
  name            = "${var.name}-wiki"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  health_check_grace_period_seconds  = var.health_check_grace_period_seconds
  enable_execute_command             = false
  enable_ecs_managed_tags            = true
  propagate_tags                     = "SERVICE"

  deployment_circuit_breaker {
    enable   = true
    rollback = false
  }

  deployment_controller {
    type = "ECS"
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.this.id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = local.container_name
    container_port   = var.container_port
  }

  tags = merge(local.common_tags, {
    "agent-wiki/application-version" = var.application_version
    "agent-wiki/activation-receipt"  = coalesce(var.activation_receipt_sha256, "not-activated")
    "agent-wiki/image-digest"        = split("@", var.image_uri)[1]
  })

  depends_on = [aws_iam_role_policy.execution]

  lifecycle {
    precondition {
      condition     = var.desired_count == 0 || var.activation_receipt_sha256 != null
      error_message = "activation_receipt_sha256 is required before desired_count can become one."
    }
  }
}
