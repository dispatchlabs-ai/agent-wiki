# Agent Wiki ECS service module

This standard OpenTofu module defines one independent Agent Wiki service on
AWS ECS/Fargate with one durable S3 Files `/data` mount and either a caller-owned HTTP target
group or private Cloud Map discovery. Agent Wiki remains
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

## Private discovery

For an existing private HTTPS proxy and SSM relay, set `target_group_arn = null`
and supply `service_registry_arn` for a caller-owned Cloud Map service with an A
record and custom health checking. Keep `ingress_security_group_ids` limited to
that relay and set `container_port` to its fixed destination port. No load
balancer, DNS zone or public route is created. `service_name` can retain an
existing ECS name during an explicitly reviewed state migration.

Private discovery requires Agent Wiki 0.8.13 or newer: its container probe calls
`/bin/agent-wiki-health`, which checks the running process through loopback
`GET /healthz` on `PORT`. ECS uses that container health for Cloud Map. This
liveness check does not establish authenticated readiness or recovery.

Set `health_check_grace_period_seconds` from measured full-corpus startup time.
The ECS service scheduler applies this grace to unhealthy container and
load-balancer checks, including private discovery without a target group. The
default remains 60 seconds. A caller can select, for example, 600 seconds when
verified index initialization needs several minutes. This changes scheduler
replacement behavior during startup; it does not change the container probe,
publish a healthy discovery endpoint early, or establish application readiness.
Confirm that the actual service reaches healthy state within the selected grace
and complete authenticated browser/agent acceptance before activation is accepted.
See the [AWS service grace contract](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_CreateService.html#API_CreateService_RequestSyntax).

The module accepts Terraform/OpenTofu 1.x from 1.12.6 and AWS provider 6.x from
6.61.0. Consumer roots must retain an exact provider lock. Version constraints
express compatibility intent; the qualification record below names tested pairs.

## Release identities

The module contract is version `0.1.2`. Future module releases use signed tags
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

## Routine compatible upgrades

An initialized installation can move directly to the requested compatible image.
Read all intervening release notes for persisted-format and runtime requirements;
intermediate releases are needed only for a documented migration dependency.
A routine binary replacement does not require a new backup, restore rehearsal,
lifecycle command or external installation journal.

1. Prepare and verify the target image before changing the service. Reconcile the
   live task definition with the root's inputs, preserving capacity, storage,
   roles, secrets and network settings. Resolve any active maintenance operation
   and account for one-off writers before updating.
2. Change `image_uri` and `application_version`. Preserve the existing
   `activation_receipt_sha256` as evidence of the initialized, unchanged data root;
   it is not a fresh claim of target-image testing. Keep `desired_count = 1`.
3. Review and apply one root plan. The existing ECS minimum healthy percentage
   `0` and maximum `100` provide a stop/start replacement for one task. The
   product's exclusive owner lock remains the writer guard. Do not raise the
   maximum to overlap writers or insert a separate count-zero apply for this path.
   Expect a service interruption while the replacement starts, not zero downtime.
4. Verify the requested version/image and stable service, `/healthz`, authenticated
   `/api/articles/health.json`, and an authorized read/write through canonical HTTPS.
   Record the deployment result separately from the retained initialization receipt.

Task definitions use `skip_destroy`, retaining earlier revisions for inspected
binary rollback. A compatible rollback can use the same service-update path;
verify that the previous binary supports every persisted format now present.
Restoring older data is a separate recovery operation.

See [AWS service deployment parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html)
for scheduler behavior. Scheduler percentages do not prove exclusive ownership
for offline work or account for tasks outside the service.

## Exclusive data maintenance

Bootstrap, import, restore, repair and documented data migrations require a stopped
serving owner. Choose backups and recovery qualification for the actual change;
an image version alone does not establish that a data transition exists.

1. Apply a root plan with `desired_count = 0` using the current task definition.
2. Wait for all service and one-off writers using the data root to stop. Confirm
   the managed owner released `.lifecycle/owner.lock`; PID, age and desired count
   alone are not ownership proof.
3. Run the documented [product lifecycle command](../../../../docs/lifecycle.md)
   with one owner. Preserve a retained `.git/wiki-write.lock.d` and use its recovery
   flow; do not delete it merely because it is old.
4. Record completed maintenance, stop observations and any state-transition or
   backup evidence in a new sanitized receipt. Update `activation_receipt_sha256`
   and any selected release inputs, then apply the activation plan with count one.
   Serialize the full maintenance interval; a backend lock on one apply does not
   cover time between applies.
5. Verify version, liveness, authenticated readiness and read/write behavior.

An interrupted controller journal is recovery evidence, not a release dependency.
Reconcile ownership and durable changes before continuing. If the retained tool
cannot cancel or supersede its immutable target, report that limitation and
resolve the operation explicitly; do not activate an unwanted intermediate
release solely to satisfy its completion state machine.

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
tofu -chdir=infra/aws/examples/wiki-service init -backend=false
tofu -chdir=infra/aws/examples/wiki-service validate
```

The provider-mocked test suite was removed on October 16, 2026. The commands
above check formatting and configuration validity without applying AWS changes;
they do not exercise the service's runtime or deployment workflow.

This validation does not prove live S3 Files behavior. Agent Wiki's managed
lifecycle currently relies on `flock`, atomic rename, Git, and SQLite/WAL
semantics. Existing S3 Files experiments are useful evidence but remain a
separate live acceptance gate for this exact image, filesystem configuration,
and stop/replacement workflow. Do not claim an installation ready until that
gate, independent recovery, and functional browser/agent acceptance pass.

Private installations can set `egress_rules` to retain a narrower existing
network policy, such as HTTPS plus NFS to a storage security group. Omission
preserves the module's original outbound policy. Live cloud acceptance remains
a separate deployment step.
