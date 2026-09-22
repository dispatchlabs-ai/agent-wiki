# Agent Wiki ECS service module

This standard OpenTofu module defines one independent Agent Wiki service on
AWS ECS/Fargate with one durable S3 Files `/data` mount. Agent Wiki remains
useful when Agent House and Dispatch are absent. The module does not create a
shared platform, custom deployment bundle, VPC, cluster, S3 bucket, S3 Files
filesystem, load balancer, certificate, DNS record, or target group.

The caller owns those shared and ingress resources. This module is the only
owner of its ECS service fields, retained task-definition revisions, task and
execution roles, task security group, S3 Files access point, and log group.
Do not configure another deployer to rewrite its service task definition,
desired count, network configuration, or target-group attachment.
OpenTofu owns `desired_count`: a deployment driver changes the root input and
applies a reviewed plan; it must never call ECS `UpdateService` for that field.

## Ordinary root-module composition

Pin the module source to an exact reviewed commit. Select the application
release and full image digest separately:

```hcl
terraform {
  required_version = ">= 1.12.6, < 1.13.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.61.0"
    }
  }
}

module "wiki" {
  source = "git::https://github.com/dispatchlabs-ai/agent-wiki.git//infra/aws/modules/wiki-service?ref=0123456789abcdef0123456789abcdef01234567"

  name                       = "example-company"
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnet_ids
  cluster_arn                = module.runtime.cluster_arn
  target_group_arn           = module.ingress.wiki_target_group_arn
  ingress_security_group_ids = [module.ingress.security_group_id]

  origin              = "https://wiki.example.com"
  application_version = "0.8.8"
  image_uri           = "123456789012.dkr.ecr.us-east-1.amazonaws.com/agent-wiki@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  ecr_repository_arns = ["arn:aws:ecr:us-east-1:123456789012:repository/agent-wiki"]

  s3_files_file_system_id  = module.storage.file_system_id
  s3_files_file_system_arn = module.storage.file_system_arn
  s3_files_bucket_arn      = module.storage.bucket_arn
  s3_files_prefix          = "agent-wiki/"

  # Keep zero for the first apply and throughout bootstrap or exclusive work.
  desired_count = 0

  environment = {
    WIKI_WRITE = "1"
  }

  # Values are exact external references, never secret bytes.
  secret_environment = {
    WIKI_AGENT_TOKEN_KEY = "arn:aws:ssm:us-east-1:123456789012:parameter/example-company/wiki/agent-token-key"
  }
}
```

The repository also contains a locally sourced, validating root example at
`infra/aws/examples/wiki-service`. This ordinary root composition is the
standard interface. Terragrunt remains a later comparison on an actual
repeated reference deployment; this module does not require it.

## Release identities

The module contract is version `0.1.0`. Future module releases use signed tags
named `wiki-service-vMAJOR.MINOR.PATCH`, but an operated installation records
the exact Git commit used by its `source` argument. The module version, source
commit, provider lock, application version, and full `image_uri` digest are
independent pins. Changing the application image does not imply a module
upgrade, and changing this module does not select an application release.

The `release` output supplies the exact module contract version, application
version, image URI, task-definition revision, and service identity for an
operator receipt. The caller should add its exact module source commit because
OpenTofu cannot infer a remote module's selected Git revision inside the module.

## Safe initialization and activation

The default and only safe initial state is `desired_count = 0`. The module does
not run an init container and does not start as root to create or `chown` data.
Its S3 Files access point creates the installation root as UID/GID `65532` with
mode `0700`; the image and serving process use the same identity.

An authorized deployment operator must perform initialization as a managed
one-off operation while the service and every other writer are stopped:

1. Apply the module with `desired_count = 0`. Observe zero running and zero
   pending service tasks, and list one-off tasks for the installation as well.
2. Use a temporary one-off task definition and temporary bootstrap authority to
   run `agent-wiki bootstrap --root /data ...` against this access point. The
   temporary task must use the same image digest and UID/GID, and its role may
   read only its temporary bootstrap secret.
3. Capture the bootstrap receipt and one-time setup URL through a protected
   channel. Verify the initialized marker and content HEAD, then retire the
   temporary task definition, role and secret while preserving the setup session
   for first sign-in. The service is still stopped, so the URL cannot yet be
   consumed. Never put the setup URL or secret value in
   HCL, OpenTofu state, the activation receipt, or the service log group.
4. Store a sanitized receipt containing the operation ID, task ARN, exact image
   digest, access-point ARN, initialized-marker identity, content HEAD, observed
   zero-writer checks, completion time, and operator. Hash its canonical bytes.
5. Set `activation_receipt_sha256` to that digest and `desired_count = 1`.
   OpenTofu refuses an active service without the receipt digest.
6. Once the service responds through its canonical HTTPS origin, consume the
   setup URL, verify the manager identity and browser/MCP read/write access, and
   retire any unused setup sessions. Only then mark the installation accepted.

Do not use the serving task definition directly for bootstrap unless the
operator provides a secure receipt-capture adapter. Its normal `awslogs`
configuration would persist bootstrap stdout, which contains the one-time setup
URL. A partial bootstrap remains a failed initialization: preserve it for
diagnosis or restore a fresh root; do not rerun bootstrap over it.

## Singleton upgrades and exclusive work

The ECS service sets deployment minimum healthy percent to `0` and maximum to
`100`, so normal ECS replacement has no capacity for two serving tasks. Those
percentages are only a scheduler guard. They do not prove that an old or
one-off writer has stopped, and an ordinary rolling update is not the supported
upgrade operation.

For backup, import, upgrade, recovery, or other exclusive work:

1. Create and apply a root plan with `desired_count = 0` using the currently
   selected task definition.
2. Wait until ECS reports zero running and zero pending service tasks. List and
   account for every one-off task using the access point. Confirm the managed
   owner has released `.lifecycle/owner.lock`; PID or age is not ownership proof.
3. Run the documented product lifecycle command with one owner. Preserve a
   retained `.git/wiki-write.lock.d` and inspect it through the recovery flow;
   never delete it only because it is old.
4. Record the stop observations and completed operation in a new sanitized
   activation receipt. When changing releases, include both previous and next
   image identities and any real state-transition or backup receipts.
5. Update `image_uri`, `application_version`, and
   `activation_receipt_sha256`, then create and apply a separate root plan with
   `desired_count = 1`. The two plans/applies belong to one serialized
   installation operation; an OpenTofu backend lock on either apply does not
   cover the stop, lifecycle, receipt, and activation sequence between them.
6. Verify `/healthz` through the target group, authenticated
   `/api/articles/health.json` through the canonical HTTPS origin, and an actual
   authorized read and write. A liveness response alone is not readiness.

Task definitions use `skip_destroy`, leaving older revisions registered for an
inspected binary rollback. Rollback still requires the same stop/quiescence
procedure and is safe only if the old application understands the current data
format. Restoring older data is a separate recovery operation.

## Security and storage contract

The task targets x86_64 Linux, runs as `65532:65532`, drops every Linux
capability, disables ECS Exec, and uses a read-only root filesystem. Writable
paths are the access-point-scoped `/data` mount and task-local `/tmp`. CPU,
memory, ephemeral storage, and shutdown time are explicit and bounded.

The task role can mount and write only the declared S3 Files filesystem through
this installation's access point and can read/list only its corresponding
bucket prefix. The separate execution role can write this service's logs, read
only declared secret references, decrypt only declared KMS keys, and pull only
declared ECR repositories. `environment` holds ordinary configuration;
`secret_environment` holds exact Secrets Manager or SSM references. Their names
must not overlap.

The module creates no EFS resource or fallback. The S3 Files access-point root
is `/wiki/NAME/data`, corresponding to
`S3_FILES_PREFIX/wiki/NAME/data/` in the authoritative bucket.

## Validation boundary

Local validation uses OpenTofu 1.12.6 and AWS provider 6.61.0:

```sh
tofu fmt -check -recursive infra/aws
tofu -chdir=infra/aws/modules/wiki-service init -backend=false
tofu -chdir=infra/aws/modules/wiki-service validate
tofu -chdir=infra/aws/modules/wiki-service test
tofu -chdir=infra/aws/examples/wiki-service init -backend=false
tofu -chdir=infra/aws/examples/wiki-service validate
```

The tests use a mocked provider and make no AWS API calls. They check the full
image digest, x86_64 target, non-root identity, dropped capabilities, read-only
root, S3 Files access-point mount, task-definition retention, singleton service
settings, receipt gate, secret-reference separation, and exact release outputs.

This validation does not prove live S3 Files behavior. Agent Wiki's managed
lifecycle currently relies on `flock`, atomic rename, Git, and SQLite/WAL
semantics. Existing S3 Files experiments are useful evidence but remain a
separate live acceptance gate for this exact image, filesystem configuration,
and stop/replacement workflow. Do not claim an installation ready until that
gate, independent recovery, and functional browser/agent acceptance pass.
