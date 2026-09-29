# AWS deployment module contract

Agent Wiki publishes a standard OpenTofu module at
`infra/aws/modules/wiki-service` for one independent ECS/Fargate service backed
by a caller-owned S3 Files filesystem. Its complete inputs, ordinary root HCL,
bootstrap and singleton activation procedure, release pins, local validation,
and limits are in the [module README](../infra/aws/modules/wiki-service/README.md).

The module owns only installation-specific service resources: retained ECS task
definitions, the ECS service and its target-group or private-discovery attachment, a task security
group, one POSIX S3 Files access point, scoped runtime and execution roles, and
one CloudWatch log group. The caller owns networking, subnets, cluster, S3 Files
filesystem and bucket, and HTTPS ingress resources. Another deployment tool must
not rewrite module-owned ECS service fields. OpenTofu is the single owner of
`desired_count`; an operator changes the root input and applies a reviewed plan,
never a separate ECS `UpdateService` mutation.

The application and module have separate release identities. Callers pin the
module to an exact Git commit, an explicitly qualified AWS provider through the root lockfile, and
the x86_64 Linux application image to a full `sha256` digest. The module's
`release` output records the selected module contract, application release,
image, task revision, and service identity.

The module defaults serving to zero and requires a non-secret activation receipt
digest before serving one task. Initialization is an explicit managed one-off
operation with temporary bootstrap authority; it is never a root init container
or automatic `chown` migration. Upgrades and exclusive operations stop the
service, wait for every serving and one-off writer to stop, verify ownership
release, perform the product lifecycle operation, and only then activate the new
task revision. ECS deployment percentages prevent scheduler overlap but do not
replace that observed quiescence contract. Quiescence and activation are two
separate root plans/applies inside one serialized installation operation; the
workflow lock must span the work between them.

The task runs as UID/GID 65532, drops all capabilities, disables ECS Exec, uses a
read-only root with task-local `/tmp`, mounts only its access-point-scoped
`/data`, and has explicit CPU and memory bounds. Configuration strings and secret
references are separate; secret values never belong in HCL or state.

For an application release that supports the optional managed trace projection,
module 0.1.1 can pass `environment = { WIKI_TRACE_INDEX_ROOT = "/tmp/wiki-trace-index" }`
through its existing configuration map. Its task-local `/tmp` mount provides the
cache location; no module resource or application-authority layout changes are
needed. This setting is unsupported by earlier application releases, including
0.8.14: select a qualified immutable application release before enabling it.
The [lifecycle contract](lifecycle.md) describes verification, disk requirements
and stopped-owner replacement. Module version and application version remain
independent.

Local mocked plans establish the static module contract without credentials or
cloud calls. Live acceptance remains required because the current managed
lifecycle uses POSIX `flock`, atomic rename, Git, and SQLite/WAL behavior. Prior
S3 Files experiments do not by themselves qualify this exact service. A live
gate must prove acknowledged writes, task replacement without competing owners,
permissions, interrupted-write handling, and functional restoration before an
installation is called ready.

Module 0.1.1 supports caller-owned private Cloud Map discovery without a load
balancer. That path requires the packaged loopback health probe in Agent Wiki
0.8.13 or newer. The operator still owns trusted HTTPS, routing and access.

### Module 0.1.1 compatibility qualification

The provider-mocked suite passed all nine cases with OpenTofu 1.12.6 / AWS
6.61.0 and Terraform 1.13.3 / AWS 6.64.0. Mocked apply is used where assertions
need computed resource attributes; it creates no real infrastructure. These
pairs are tested, while the declared version ranges express compatibility
intent. A customer deployment still needs its own real plan and runtime checks.

For a pre-existing filesystem that exposes the whole bucket, pass
`s3_files_prefix = ""`. For a filesystem exposing a bucket subdirectory, pass
that exact relative prefix with a trailing slash. This input describes storage
already created by the caller; it must not invent or change its mount boundary.
