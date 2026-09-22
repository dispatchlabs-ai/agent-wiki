# AWS deployment module contract

Agent Wiki publishes a standard OpenTofu module at
`infra/aws/modules/wiki-service` for one independent ECS/Fargate service backed
by a caller-owned S3 Files filesystem. Its complete inputs, ordinary root HCL,
bootstrap and singleton activation procedure, release pins, local validation,
and limits are in the [module README](../infra/aws/modules/wiki-service/README.md).

The module owns only installation-specific service resources: retained ECS task
definitions, the ECS service and its target-group attachment, a task security
group, one POSIX S3 Files access point, scoped runtime and execution roles, and
one CloudWatch log group. The caller owns networking, subnets, cluster, S3 Files
filesystem and bucket, and HTTPS ingress resources. Another deployment tool must
not rewrite module-owned ECS service fields. OpenTofu is the single owner of
`desired_count`; an operator changes the root input and applies a reviewed plan,
never a separate ECS `UpdateService` mutation.

The application and module have separate release identities. Callers pin the
module to an exact Git commit, AWS provider 6.61.0 through the root lockfile, and
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

Local mocked plans establish the static module contract without credentials or
cloud calls. Live acceptance remains required because the current managed
lifecycle uses POSIX `flock`, atomic rename, Git, and SQLite/WAL behavior. Prior
S3 Files experiments do not by themselves qualify this exact service. A live
gate must prove acknowledged writes, task replacement without competing owners,
permissions, interrupted-write handling, and functional restoration before an
installation is called ready.
