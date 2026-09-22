mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn    = "arn:aws:logs:us-east-1:123456789012:log-group:/agent-wiki/example/service"
      region = "us-east-1"
    }
  }

  mock_resource "aws_security_group" {
    defaults = {
      id = "sg-0123456789abcdef0"
    }
  }

  mock_resource "aws_s3files_access_point" {
    defaults = {
      id  = "fsap-0123456789abcdef0"
      arn = "arn:aws:s3files:us-east-1:123456789012:access-point/fsap-0123456789abcdef0"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      id  = "agent-wiki-test-role"
      arn = "arn:aws:iam::123456789012:role/agent-wiki-test-role"
    }
  }

  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn      = "arn:aws:ecs:us-east-1:123456789012:task-definition/example-wiki:7"
      revision = 7
    }
  }

  mock_resource "aws_ecs_service" {
    defaults = {
      arn = "arn:aws:ecs:us-east-1:123456789012:service/example/example-wiki"
      id  = "arn:aws:ecs:us-east-1:123456789012:service/example/example-wiki"
    }
  }
}

variables {
  name                       = "example"
  vpc_id                     = "vpc-0123456789abcdef0"
  subnet_ids                 = ["subnet-0123456789abcdef0", "subnet-1123456789abcdef0"]
  cluster_arn                = "arn:aws:ecs:us-east-1:123456789012:cluster/example"
  target_group_arn           = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/example/0123456789abcdef"
  ingress_security_group_ids = ["sg-1123456789abcdef0"]
  origin                     = "https://wiki.example.test"
  image_uri                  = "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-wiki@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  application_version        = "0.8.8"
  s3_files_file_system_id    = "fs-0123456789abcdef0"
  s3_files_file_system_arn   = "arn:aws:s3files:us-east-1:123456789012:file-system/fs-0123456789abcdef0"
  s3_files_bucket_arn        = "arn:aws:s3:::agent-wiki-example"
  s3_files_prefix            = "installations/"
}

run "plans_safe_zero_count_foundation" {
  command = plan

  assert {
    condition     = aws_ecs_service.this.desired_count == 0
    error_message = "A fresh module must keep serving at zero until managed bootstrap succeeds."
  }

  assert {
    condition = (
      aws_ecs_service.this.deployment_minimum_healthy_percent == 0 &&
      aws_ecs_service.this.deployment_maximum_percent == 100
    )
    error_message = "The ECS scheduler must never have capacity for an overlapping replacement task."
  }

  assert {
    condition     = aws_ecs_task_definition.this.skip_destroy
    error_message = "Old task-definition revisions must remain registered for inspected rollback."
  }
}

run "plans_one_nonroot_writer_after_receipt" {
  command = plan

  variables {
    desired_count             = 1
    activation_receipt_sha256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    environment = {
      WIKI_WRITE = "1"
    }
    secret_environment = {
      WIKI_AGENT_TOKEN_KEY = "arn:aws:secretsmanager:us-east-1:123456789012:secret:wiki/token-key"
    }
  }

  assert {
    condition = (
      aws_ecs_service.this.desired_count == 1 &&
      aws_ecs_service.this.cluster == "arn:aws:ecs:us-east-1:123456789012:cluster/example" &&
      aws_ecs_service.this.task_definition == aws_ecs_task_definition.this.arn &&
      one(aws_ecs_service.this.load_balancer).target_group_arn == "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/example/0123456789abcdef" &&
      toset(one(aws_ecs_service.this.network_configuration).security_groups) == toset([aws_security_group.this.id])
    )
    error_message = "The module must own the exact service task, load-balancer attachment, count, and service security group fields."
  }

  assert {
    condition = (
      aws_ecs_task_definition.this.runtime_platform[0].cpu_architecture == "X86_64" &&
      aws_ecs_task_definition.this.runtime_platform[0].operating_system_family == "LINUX" &&
      aws_ecs_task_definition.this.cpu == "512" &&
      aws_ecs_task_definition.this.memory == "2048"
    )
    error_message = "The task must target the current bounded x86_64 Linux package."
  }

  assert {
    condition = (
      jsondecode(aws_ecs_task_definition.this.container_definitions)[0].user == "65532:65532" &&
      jsondecode(aws_ecs_task_definition.this.container_definitions)[0].readonlyRootFilesystem &&
      jsondecode(aws_ecs_task_definition.this.container_definitions)[0].linuxParameters.capabilities.add == [] &&
      jsondecode(aws_ecs_task_definition.this.container_definitions)[0].linuxParameters.capabilities.drop == ["ALL"]
    )
    error_message = "The Wiki container must run as 65532 with a read-only root and every Linux capability dropped."
  }

  assert {
    condition = (
      jsondecode(aws_ecs_task_definition.this.container_definitions)[0].mountPoints[0].containerPath == "/data" &&
      jsondecode(aws_ecs_task_definition.this.container_definitions)[0].mountPoints[1].containerPath == "/tmp" &&
      one(one([for volume in aws_ecs_task_definition.this.volume : volume if volume.name == "data"]).s3files_volume_configuration).access_point_arn == aws_s3files_access_point.data.arn &&
      aws_s3files_access_point.data.posix_user[0].uid == 65532 &&
      aws_s3files_access_point.data.posix_user[0].gid == 65532 &&
      aws_s3files_access_point.data.root_directory[0].creation_permissions[0].permissions == "0700"
    )
    error_message = "Only the installation access point may back writable /data; /tmp must be task-local and POSIX ownership must match the container."
  }

  assert {
    condition = (
      one([for item in jsondecode(aws_ecs_task_definition.this.container_definitions)[0].environment : item.value if item.name == "WIKI_WRITE"]) == "1" &&
      one([for item in jsondecode(aws_ecs_task_definition.this.container_definitions)[0].secrets : item.valueFrom if item.name == "WIKI_AGENT_TOKEN_KEY"]) == "arn:aws:secretsmanager:us-east-1:123456789012:secret:wiki/token-key" &&
      length([for item in jsondecode(aws_ecs_task_definition.this.container_definitions)[0].environment : item if item.name == "WIKI_AGENT_TOKEN_KEY"]) == 0
    )
    error_message = "Plain configuration and secret references must remain independent, and secret values must not enter the task definition or state."
  }

  assert {
    condition = (
      output.release.application_version == "0.8.8" &&
      output.release.activation_receipt == "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" &&
      output.release.image_uri == "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-wiki@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" &&
      output.release.task_definition_arn == aws_ecs_task_definition.this.arn &&
      output.release.service_name == aws_ecs_service.this.name &&
      output.release.module_version == "0.1.0"
    )
    error_message = "The deployment receipt output must report exact, independently selected module, application, image, task, and service identities."
  }
}

run "rejects_mutable_image_reference" {
  command = plan

  variables {
    image_uri = "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-wiki:0.8.8"
  }

  expect_failures = [var.image_uri]
}

run "rejects_active_service_without_operator_receipt" {
  command = plan

  variables {
    desired_count = 1
  }

  expect_failures = [aws_ecs_service.this]
}

run "rejects_plaintext_override_of_secret_name" {
  command = plan

  variables {
    environment = {
      WIKI_AGENT_TOKEN_KEY = "plaintext-is-not-allowed-here"
    }
    secret_environment = {
      WIKI_AGENT_TOKEN_KEY = "arn:aws:ssm:us-east-1:123456789012:parameter/wiki/token-key"
    }
  }

  expect_failures = [aws_ecs_task_definition.this]
}

run "plans_longest_installation_name" {
  command = plan

  variables {
    name = "abcdefghijklmnopqrstuvwxyzabcdefghijkl"
  }

  assert {
    condition = (
      length(aws_iam_role.task.name_prefix) <= 38 &&
      length(aws_iam_role.execution.name_prefix) <= 38 &&
      aws_ecs_service.this.name == "abcdefghijklmnopqrstuvwxyzabcdefghijkl-wiki"
    )
    error_message = "Long installation identities must retain the full service name while fitting provider role-prefix limits."
  }
}
