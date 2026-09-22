#!/usr/bin/env python3
"""Single-owner lifecycle for a managed Agent Wiki data root."""

from __future__ import annotations

import argparse
import configparser
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import urlsplit, urlunsplit
import uuid


FORMAT = 1
ENGINE = Path(__file__).resolve().parent.parent
LAYOUT = {
    "content": "content",
    "control": "control/control.sqlite3",
    "traces": "traces",
    "article_media": "article-media",
}
ACTIVE_LOCK_FD: int | None = None
LOCAL_EVIDENCE = {"mode": "local"}


class LifecycleError(Exception):
    def __init__(self, code: str, message: str, exit_code: int = 1):
        super().__init__(message)
        self.code = code
        self.exit_code = exit_code


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_file(filename: Path) -> str:
    result = hashlib.sha256()
    with filename.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def sync_directory(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_write(filename: Path, value: bytes, mode: int = 0o600) -> None:
    filename.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = filename.with_name(f".{filename.name}.{uuid.uuid4().hex}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as target:
            target.write(value)
            target.flush()
            os.fsync(target.fileno())
    finally:
        os.close(descriptor)
    os.replace(temporary, filename)
    os.chmod(filename, mode)
    sync_directory(filename.parent)


def root_path(value: str, *, create: bool = False) -> Path:
    supplied = Path(value)
    if not supplied.is_absolute():
        raise LifecycleError("INVALID_ROOT", "--root must be an absolute path", 2)
    if supplied.exists() and supplied.is_symlink():
        raise LifecycleError("INVALID_ROOT", "The managed root cannot be a symlink", 2)
    root = supplied.resolve()
    if root == Path(root.anchor):
        raise LifecycleError("INVALID_ROOT", "The managed root must be a dedicated directory", 2)
    if create:
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(root, 0o700)
    if not root.is_dir():
        raise LifecycleError("INVALID_ROOT", f"Managed root does not exist: {root}", 2)
    return root


def lock_path(root: Path) -> Path:
    return root / ".lifecycle" / "owner.lock"


def open_lock(root: Path) -> int:
    lifecycle = root / ".lifecycle"
    if lifecycle.exists() and lifecycle.is_symlink():
        raise LifecycleError("INVALID_ROOT", ".lifecycle cannot be a symlink")
    lifecycle.mkdir(mode=0o700, exist_ok=True)
    filename = lock_path(root)
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(filename, flags, 0o600)
    details = os.fstat(descriptor)
    if not stat.S_ISREG(details.st_mode) or details.st_nlink != 1:
        os.close(descriptor)
        raise LifecycleError("INVALID_LOCK", "owner.lock must be one regular file")
    return descriptor


def clean_owner_temporaries(root: Path) -> None:
    lifecycle = root / ".lifecycle"
    removed = False
    for entry in lifecycle.iterdir():
        if not re.fullmatch(r"\.owner\.json\.[a-f0-9]{32}\.tmp", entry.name):
            continue
        details = entry.lstat()
        if not stat.S_ISREG(details.st_mode) or entry.is_symlink():
            raise LifecycleError(
                "INVALID_LOCK",
                "Interrupted owner metadata temporary must be one regular file",
            )
        entry.unlink()
        removed = True
    if removed:
        sync_directory(lifecycle)


@contextlib.contextmanager
def ownership(root: Path, operation: str):
    global ACTIVE_LOCK_FD
    descriptor = open_lock(root)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            owner = read_json(root / ".lifecycle" / "owner.json")
            suffix = f"; diagnostic owner: {json.dumps(owner, sort_keys=True)}" if owner else ""
            raise LifecycleError(
                "LIFECYCLE_BUSY",
                f"Another managed owner holds {lock_path(root)}{suffix}",
                3,
            ) from error
        # owner.json is diagnostic, but atomic replacement can leave its private
        # temporary behind after a crash. Only the current kernel-lock holder may
        # remove a narrowly named ordinary temporary before starting a new owner.
        clean_owner_temporaries(root)
        token = uuid.uuid4().hex
        owner = {
            "version": FORMAT,
            "operation": operation,
            "operation_id": token,
            "pid": os.getpid(),
            "started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        atomic_write(root / ".lifecycle" / "owner.json", canonical_json(owner))
        os.set_inheritable(descriptor, True)
        ACTIVE_LOCK_FD = descriptor
        try:
            yield descriptor
        finally:
            ACTIVE_LOCK_FD = None
            current = read_json(root / ".lifecycle" / "owner.json")
            if current and current.get("operation_id") == token:
                (root / ".lifecycle" / "owner.json").unlink(missing_ok=True)
                sync_directory(root / ".lifecycle")
    finally:
        os.close(descriptor)


def read_json(filename: Path):
    try:
        return json.loads(filename.read_text())
    except (OSError, ValueError):
        return None


def run(command: list[str], *, env=None, capture=True, check=True) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        env=env,
        check=check,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        text=True,
        pass_fds=(() if ACTIVE_LOCK_FD is None else (ACTIVE_LOCK_FD,)),
    )


def safe_git_env() -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0"})
    return env


def git_command(root: Path, arguments: list[str]) -> list[str]:
    return [
        "git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
        "-C", str(root), *arguments,
    ]


def git_bytes(root: Path, arguments: list[str], *, validate=True) -> bytes:
    if validate:
        validate_git_structure(root)
    result = subprocess.run(
        git_command(root, arguments),
        env=safe_git_env(),
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        pass_fds=(() if ACTIVE_LOCK_FD is None else (ACTIVE_LOCK_FD,)),
    )
    return result.stdout


def git(root: Path, arguments: list[str], *, capture=True, validate=True) -> str:
    if validate:
        validate_git_structure(root)
    if not capture:
        run(git_command(root, arguments), capture=False, env=safe_git_env())
        return ""
    result = git_bytes(root, arguments, validate=False).decode("utf-8")
    return result.rstrip("\n")


def paths(root: Path) -> dict[str, Path]:
    return {name: root / value for name, value in LAYOUT.items()}


def external_evidence(value: str) -> dict[str, str]:
    candidate = value if value.endswith("/") else value + "/"
    try:
        parsed = urlsplit(candidate)
    except ValueError as error:
        raise LifecycleError(
            "INVALID_EVIDENCE",
            "External evidence URL must be an HTTP(S) service base",
            2,
        ) from error
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise LifecycleError("INVALID_EVIDENCE", "External evidence URL must be an HTTP(S) service base", 2)
    return {"mode": "external", "url": urlunsplit(parsed)}


def requested_evidence(args) -> dict:
    return external_evidence(args.external_evidence_url) if args.external_evidence_url else LOCAL_EVIDENCE


def evidence_config(value: dict) -> dict:
    evidence = value.get("evidence", LOCAL_EVIDENCE)
    if evidence == LOCAL_EVIDENCE:
        return LOCAL_EVIDENCE
    if (
        not isinstance(evidence, dict)
        or evidence.get("mode") != "external"
        or set(evidence) != {"mode", "url"}
        or not isinstance(evidence.get("url"), str)
    ):
        raise LifecycleError("INVALID_LAYOUT", "Managed evidence ownership is invalid")
    normalized = external_evidence(evidence["url"])
    if normalized != evidence:
        raise LifecycleError("INVALID_LAYOUT", "Managed external evidence URL is not canonical")
    return evidence


def managed_env(
    root: Path,
    descriptor: int | None = None,
    initialized: dict | None = None,
) -> dict[str, str]:
    locations = paths(root)
    env = dict(os.environ)
    env.update(
        {
            "WIKI_LIFECYCLE_ROOT": str(root),
            "WIKI_LIFECYCLE_LOCK": str(lock_path(root)),
            "WIKI_REPO": str(locations["content"]),
            "WIKI_CONTROL": str(locations["control"]),
            "WIKI_ARTICLE_MEDIA": str(locations["article_media"]),
        }
    )
    evidence = evidence_config(initialized) if initialized else LOCAL_EVIDENCE
    if evidence["mode"] == "external":
        env.pop("WIKI_TRACES", None)
        env["WIKI_EVIDENCE_URL"] = evidence["url"]
    else:
        env["WIKI_TRACES"] = str(locations["traces"])
        env.pop("WIKI_EVIDENCE_URL", None)
    # A managed installation accepts only its validated local repository config.
    # Ignore ambient Git config and make hooks/fsmonitor inert in descendants.
    for name in [name for name in env if name.startswith("GIT_CONFIG_")]:
        env.pop(name)
    env.update(
        {
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_CONFIG_COUNT": "2",
            "GIT_CONFIG_KEY_0": "core.hooksPath",
            "GIT_CONFIG_VALUE_0": "/dev/null",
            "GIT_CONFIG_KEY_1": "core.fsmonitor",
            "GIT_CONFIG_VALUE_1": "false",
        }
    )
    if descriptor is not None:
        if descriptor != 3:
            os.dup2(descriptor, 3, inheritable=True)
        else:
            os.set_inheritable(3, True)
        env["WIKI_LIFECYCLE_LOCK_FD"] = "3"
    return env


def marker(root: Path) -> dict:
    filename = root / ".lifecycle" / "initialized.json"
    try:
        details = filename.lstat()
    except FileNotFoundError:
        details = None
    if not details or not stat.S_ISREG(details.st_mode) or filename.is_symlink():
        raise LifecycleError("NOT_INITIALIZED", "Managed root has no valid initialized marker")
    value = read_json(filename)
    if not value or value.get("version") != FORMAT or value.get("layout") != LAYOUT:
        raise LifecycleError("NOT_INITIALIZED", "Managed root has no valid initialized marker")
    evidence_config(value)
    return value


def writer_lock(root: Path) -> Path:
    content = paths(root)["content"]
    absolute = Path(git(content, ["rev-parse", "--absolute-git-dir"])).resolve()
    expected = (content / ".git").resolve()
    if absolute != expected:
        raise LifecycleError("INVALID_CONTENT", "Managed content must use its own .git directory")
    return absolute / "wiki-write.lock.d"


def validate_sqlite(filename: Path) -> dict:
    connection = sqlite3.connect(f"file:{filename}?mode=ro", uri=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise LifecycleError("INVALID_CONTROL", f"SQLite integrity check failed: {integrity}")
        managers = connection.execute(
            "SELECT COUNT(*) FROM grants WHERE space='default' AND role='manager'"
        ).fetchone()[0]
        principals = connection.execute("SELECT COUNT(*) FROM principals").fetchone()[0]
        if managers < 1 or principals < 1:
            raise LifecycleError("INVALID_CONTROL", "Control store has no manager")
        return {"integrity": integrity, "managers": managers, "principals": principals}
    finally:
        connection.close()


def validate_git_config(content: Path) -> None:
    filename = content / ".git" / "config"
    if not filename.is_file() or filename.is_symlink():
        raise LifecycleError("UNSAFE_GIT_CONFIG", "Managed Git config must be one regular file")
    parser = configparser.RawConfigParser(interpolation=None, strict=True)
    parser.optionxform = str.lower
    try:
        with filename.open() as source:
            parser.read_file(source)
    except (OSError, configparser.Error) as error:
        raise LifecycleError("UNSAFE_GIT_CONFIG", "Managed Git config is not safely parseable") from error
    core = {
        "repositoryformatversion", "filemode", "bare", "logallrefupdates",
        "ignorecase", "precomposeunicode", "symlinks",
    }
    user = {"name", "email"}
    remote = {"url", "pushurl", "fetch", "tagopt", "mirror"}
    branch = {"remote", "merge", "rebase", "description"}
    extensions = {"objectformat", "refstorage"}
    for section in parser.sections():
        lowered = section.lower()
        family = lowered.split(" ", 1)[0]
        keys = set(parser[section])
        allowed = (
            core if lowered == "core" else user if lowered == "user" else
            remote if family == "remote" else branch if family == "branch" else
            extensions if lowered == "extensions" else None
        )
        if allowed is None or not keys.issubset(allowed):
            raise LifecycleError("UNSAFE_GIT_CONFIG", f"Unsupported managed Git config section or key: {section}")
        if family == "remote":
            for key in ("url", "pushurl"):
                for value in parser[section].get(key, "").split("\n"):
                    if value and not valid_git_remote(value):
                        raise LifecycleError("UNSAFE_GIT_CONFIG", f"Unsafe managed Git remote URL in {section}")


def valid_git_remote(value: str) -> bool:
    if value.startswith(("https://", "file://")):
        return not any(character in value for character in ("\r", "\n", "\0"))
    if value.startswith("ssh://"):
        try:
            parsed = urlsplit(value)
            port = parsed.port
        except ValueError:
            return False
        return bool(
            parsed.scheme == "ssh"
            and parsed.hostname
            and re.fullmatch(r"[A-Za-z0-9._:-]+", parsed.hostname)
            and (not parsed.username or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", parsed.username))
            and not parsed.password
            and not parsed.query
            and not parsed.fragment
            and (port is None or 0 < port < 65536)
            and re.fullmatch(r"/[A-Za-z0-9._~+/=@%:,/-]*", parsed.path)
        )
    # Git's SCP-style SSH form permits a configured host alias. Keep the remote
    # command path to a conservative, shell-inert character set and reject remote
    # helpers (`ext::`), option-like hosts, whitespace, and shell substitutions.
    return bool(re.fullmatch(
        r"(?:[A-Za-z0-9][A-Za-z0-9._-]*@)?"
        r"[A-Za-z0-9][A-Za-z0-9._-]*:"
        r"[A-Za-z0-9._~/][A-Za-z0-9._~+/=@%:,/-]*",
        value,
    ))


def validate_git_structure(content: Path) -> None:
    try:
        content_details = content.lstat()
        git_directory = content / ".git"
        git_details = git_directory.lstat()
    except FileNotFoundError as error:
        raise LifecycleError("UNSAFE_GIT_STRUCTURE", "Managed content repository is incomplete") from error
    if (
        not stat.S_ISDIR(content_details.st_mode)
        or content.is_symlink()
        or not stat.S_ISDIR(git_details.st_mode)
        or git_directory.is_symlink()
    ):
        raise LifecycleError("UNSAFE_GIT_STRUCTURE", "Managed content and .git must be ordinary directories")
    for relative in (
        "commondir",
        "gitdir",
        "config.worktree",
        "objects/info/alternates",
        "objects/info/http-alternates",
    ):
        if (git_directory / relative).exists() or (git_directory / relative).is_symlink():
            raise LifecycleError("UNSAFE_GIT_STRUCTURE", f"External Git state redirect is forbidden: .git/{relative}")
    for relative in ("HEAD", "config"):
        filename = git_directory / relative
        try:
            details = filename.lstat()
        except FileNotFoundError as error:
            raise LifecycleError("UNSAFE_GIT_STRUCTURE", f"Missing managed Git file: .git/{relative}") from error
        if not stat.S_ISREG(details.st_mode) or filename.is_symlink():
            raise LifecycleError("UNSAFE_GIT_STRUCTURE", f"Managed Git file must be regular: .git/{relative}")
    validate_git_config(content)


def validate_ready(root: Path, *, allow_writer_lock=False) -> dict:
    initialized = marker(root)
    evidence = evidence_config(initialized)
    locations = paths(root)
    required_directories = ["content", "article_media"]
    if evidence["mode"] == "local":
        required_directories.append("traces")
    for name in required_directories:
        if not locations[name].is_dir() or locations[name].is_symlink():
            raise LifecycleError("INVALID_LAYOUT", f"Invalid managed {name} path")
    if locations["traces"].exists() and locations["traces"].is_symlink():
        raise LifecycleError("INVALID_LAYOUT", "Invalid managed traces path")
    if not locations["control"].is_file() or locations["control"].is_symlink():
        raise LifecycleError("INVALID_LAYOUT", "Invalid managed control database")
    validate_git_structure(locations["content"])
    if writer_lock(root).exists() and not allow_writer_lock:
        raise LifecycleError(
            "INTERRUPTED_WRITE",
            "Retained wiki-write.lock.d requires inspect-recovery and explicit recovery",
            3,
        )
    head = git(locations["content"], ["rev-parse", "HEAD"])
    git(locations["content"], ["fsck", "--no-dangling"])
    control = validate_sqlite(locations["control"])
    return {"marker": initialized, "head": head, "control": control, "evidence": evidence}


def root_entries(root: Path) -> list[str]:
    return sorted(entry.name for entry in root.iterdir() if entry.name != ".lifecycle")


def bootstrap(args) -> None:
    root = root_path(args.root, create=True)
    with ownership(root, "bootstrap"):
        initialized = root / ".lifecycle" / "initialized.json"
        if initialized.exists():
            raise LifecycleError("ALREADY_INITIALIZED", "Refusing to bootstrap an initialized root", 3)
        extra_lifecycle = sorted(
            entry.name
            for entry in (root / ".lifecycle").iterdir()
            if entry.name not in {"owner.lock", "owner.json"}
        )
        if root_entries(root) or extra_lifecycle:
            raise LifecycleError(
                "PARTIAL_STATE",
                "Refusing to bootstrap a nonempty or partially initialized root",
                3,
            )
        locations = paths(root)
        evidence = requested_evidence(args)
        locations["content"].mkdir(mode=0o700)
        locations["control"].parent.mkdir(mode=0o700)
        if evidence["mode"] == "local":
            locations["traces"].mkdir(mode=0o700)
        locations["article_media"].mkdir(mode=0o700)
        git(locations["content"], ["init", "-b", "main"], validate=False)
        git(locations["content"], ["config", "user.name", args.git_name])
        git(locations["content"], ["config", "user.email", args.git_email])
        git(locations["content"], ["commit", "--allow-empty", "-m", "Initialize Agent Wiki"])
        env = managed_env(root, initialized={"evidence": evidence})
        env["WIKI_ORIGIN"] = args.origin
        account = run(
            [
                args.node,
                str(ENGINE / "scripts" / "local-account.mjs"),
                "bootstrap",
                args.manager_email,
                args.manager_name,
            ],
            env=env,
        )
        if evidence["mode"] == "local":
            run(
                [
                    args.node,
                    str(ENGINE / "scripts" / "index-traces.mjs"),
                    str(locations["traces"]),
                ],
                env=env,
            )
        state = {
            "version": FORMAT,
            "layout": LAYOUT,
            "initialized_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "origin": args.origin,
            "content_head": git(locations["content"], ["rev-parse", "HEAD"]),
            "evidence": evidence,
        }
        validate_sqlite(locations["control"])
        git(locations["content"], ["fsck", "--no-dangling"])
        # This is the commit point. A crash before it leaves visible partial state
        # which ordinary bootstrap and serve both refuse.
        atomic_write(initialized, canonical_json(state))
        result = json.loads(account.stdout)
        result.update({"state": "initialized", "root": str(root), "content_head": state["content_head"]})
        print(json.dumps(result, sort_keys=True))


def lifecycle_extras(root: Path) -> list[Path]:
    return sorted(
        (
            entry
            for entry in (root / ".lifecycle").iterdir()
            if entry.name not in {"owner.lock", "owner.json"}
        ),
        key=lambda entry: entry.name,
    )


def adoption_marker_temporary(entry: Path) -> bool:
    try:
        details = entry.lstat()
    except FileNotFoundError:
        return False
    return bool(
        re.fullmatch(r"\.initialized\.json\.[a-f0-9]{32}\.tmp", entry.name)
        and stat.S_ISREG(details.st_mode)
        and not entry.is_symlink()
    )


def adopt(args) -> None:
    root = root_path(args.root)
    evidence = requested_evidence(args)
    with ownership(root, "adopt"):
        initialized_file = root / ".lifecycle" / "initialized.json"
        if initialized_file.exists() or initialized_file.is_symlink():
            initialized = marker(root)
            if initialized.get("origin") != args.origin or evidence_config(initialized) != evidence:
                raise LifecycleError(
                    "ALREADY_INITIALIZED",
                    "Managed root is initialized with different origin or evidence settings",
                    3,
                )
            ready = validate_ready(root)
            print(json.dumps({
                "state": "already-adopted", "root": str(root),
                "content_head": ready["head"], "control": ready["control"],
                "evidence": ready["evidence"],
            }, sort_keys=True))
            return

        extras = lifecycle_extras(root)
        unexpected = [entry.name for entry in extras if not adoption_marker_temporary(entry)]
        if unexpected:
            raise LifecycleError(
                "PARTIAL_STATE",
                f"Refusing adoption with unexpected lifecycle state: {', '.join(unexpected)}",
                3,
            )
        allowed = {"content", "control", "traces", "article-media", "search"}
        unexpected_root = sorted(set(root_entries(root)) - allowed)
        if unexpected_root:
            raise LifecycleError(
                "INVALID_LAYOUT",
                f"Managed root contains unexpected paths: {', '.join(unexpected_root)}",
                3,
            )
        locations = paths(root)
        control_parent = locations["control"].parent
        if not control_parent.is_dir() or control_parent.is_symlink():
            raise LifecycleError("INVALID_LAYOUT", "Existing control parent must be an ordinary directory")
        if not locations["control"].is_file() or locations["control"].is_symlink():
            raise LifecycleError("INVALID_LAYOUT", "Existing control database must be one regular file")
        validate_git_structure(locations["content"])
        lock = writer_lock(root)
        if lock.exists() or lock.is_symlink():
            raise LifecycleError(
                "INTERRUPTED_WRITE",
                "Retained wiki-write.lock.d requires reconciliation before adoption",
                3,
            )
        head = git(locations["content"], ["rev-parse", "HEAD"])
        git(locations["content"], ["fsck", "--no-dangling"])
        if git(locations["content"], ["status", "--porcelain=v1", "-z", "--untracked-files=all"]):
            raise LifecycleError("WORKTREE_CONFLICT", "Content worktree must be clean for adoption", 3)
        control = validate_sqlite(locations["control"])
        if locations["article_media"].exists():
            if not locations["article_media"].is_dir() or locations["article_media"].is_symlink():
                raise LifecycleError("INVALID_LAYOUT", "Existing article-media path must be an ordinary directory")
        if evidence["mode"] == "local":
            if locations["traces"].exists():
                if not locations["traces"].is_dir() or locations["traces"].is_symlink():
                    raise LifecycleError("INVALID_LAYOUT", "Existing traces path must be an ordinary directory")
        elif locations["traces"].exists():
            if not locations["traces"].is_dir() or locations["traces"].is_symlink():
                raise LifecycleError("INVALID_LAYOUT", "Existing traces path must be an ordinary directory")
            if any(locations["traces"].iterdir()):
                raise LifecycleError(
                    "EVIDENCE_CONFLICT",
                    "External evidence adoption refuses a nonempty local traces directory",
                    3,
                )
        if not locations["article_media"].exists():
            locations["article_media"].mkdir(mode=0o700)
        if evidence["mode"] == "local" and not locations["traces"].exists():
            locations["traces"].mkdir(mode=0o700)
        sync_directory(root)
        state = {
            "version": FORMAT,
            "layout": LAYOUT,
            "adopted_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "origin": args.origin,
            "content_head": head,
            "evidence": evidence,
        }
        atomic_write(initialized_file, canonical_json(state))
        for entry in extras:
            entry.unlink(missing_ok=True)
        sync_directory(root / ".lifecycle")
        ready = validate_ready(root)
        print(json.dumps({
            "state": "adopted", "root": str(root), "content_head": ready["head"],
            "control": control, "evidence": evidence,
        }, sort_keys=True))


def serve(args) -> None:
    root = root_path(args.root)
    with ownership(root, "serve") as descriptor:
        ready = validate_ready(root)
        env = managed_env(root, descriptor, ready["marker"])
        env["WIKI_ORIGIN"] = args.origin or env.get("WIKI_ORIGIN") or ready["marker"]["origin"]
        env["WIKI_LISTEN_HOST"] = args.bind or env.get("WIKI_LISTEN_HOST", "127.0.0.1")
        if args.port is not None:
            env["PORT"] = str(args.port)
        os.execvpe(args.node, [args.node, str(ENGINE / "src" / "server.mjs")], env)


def maintenance(args) -> None:
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        raise LifecycleError("INVALID_COMMAND", "maintenance requires a command after --", 2)
    root = root_path(args.root)
    with ownership(root, "maintenance") as descriptor:
        ready = validate_ready(root)
        os.execvpe(command[0], command, managed_env(root, descriptor, ready["marker"]))


def copy_tree(source: Path, target: Path) -> None:
    source_stat = source.lstat()
    if not stat.S_ISDIR(source_stat.st_mode) or source.is_symlink():
        raise LifecycleError("UNSAFE_SOURCE", f"Expected directory: {source}")
    target.mkdir(mode=stat.S_IMODE(source_stat.st_mode), parents=True, exist_ok=False)
    for current, directories, files in os.walk(source, topdown=True, followlinks=False):
        current_path = Path(current)
        relative = current_path.relative_to(source)
        for name in sorted(directories):
            item = current_path / name
            details = item.lstat()
            if not stat.S_ISDIR(details.st_mode) or item.is_symlink():
                raise LifecycleError("UNSAFE_SOURCE", f"Unsupported source entry: {item}")
            destination = target / relative / name
            destination.mkdir(mode=stat.S_IMODE(details.st_mode))
        for name in sorted(files):
            item = current_path / name
            details = item.lstat()
            if not stat.S_ISREG(details.st_mode) or item.is_symlink():
                raise LifecycleError("UNSAFE_SOURCE", f"Unsupported source entry: {item}")
            shutil.copy2(item, target / relative / name, follow_symlinks=False)


def manifest_files(root: Path) -> dict[str, dict]:
    result = {}
    for current, directories, files in os.walk(root, followlinks=False):
        current_path = Path(current)
        for name in sorted(directories):
            item = current_path / name
            if item.is_symlink():
                raise LifecycleError("UNSAFE_ARCHIVE", f"Archive source contains symlink: {item}")
        for name in sorted(files):
            item = current_path / name
            details = item.lstat()
            if not stat.S_ISREG(details.st_mode) or item.is_symlink():
                raise LifecycleError("UNSAFE_ARCHIVE", f"Archive source entry is not regular: {item}")
            relative = item.relative_to(root).as_posix()
            result[relative] = {
                "sha256": digest_file(item),
                "size": details.st_size,
                "mode": stat.S_IMODE(details.st_mode),
            }
    return result


def sqlite_backup(source: Path, target: Path) -> None:
    source_db = sqlite3.connect(str(source))
    target_db = sqlite3.connect(str(target))
    try:
        source_db.backup(target_db)
    finally:
        target_db.close()
        source_db.close()
    os.chmod(target, stat.S_IMODE(source.stat().st_mode))
    validate_sqlite(target)


def ensure_external(root: Path, filename: Path, code: str) -> Path:
    if not filename.is_absolute():
        raise LifecycleError(code, "Destination/archive path must be absolute", 2)
    resolved_parent = filename.parent.resolve()
    resolved = resolved_parent / filename.name
    try:
        resolved.relative_to(root)
    except ValueError:
        return resolved
    raise LifecycleError(code, "Backup material must be outside the managed root", 2)


def backup(args) -> None:
    root = root_path(args.root)
    destination = ensure_external(root, Path(args.destination), "INVALID_DESTINATION")
    if destination.exists() or destination.is_symlink():
        raise LifecycleError("DESTINATION_EXISTS", f"Refusing to replace {destination}", 3)
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with ownership(root, "backup"):
        ready = validate_ready(root)
        status = git(paths(root)["content"], ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
        if status:
            raise LifecycleError("WORKTREE_CONFLICT", "Content worktree must be clean for backup", 3)
        with tempfile.TemporaryDirectory(prefix=".agent-wiki-backup-", dir=destination.parent) as temporary:
            staging = Path(temporary) / "payload"
            staging.mkdir(mode=0o700)
            copy_tree(paths(root)["content"], staging / "content")
            (staging / "control").mkdir(mode=0o700)
            sqlite_backup(paths(root)["control"], staging / "control" / "control.sqlite3")
            if ready["evidence"]["mode"] == "local":
                copy_tree(paths(root)["traces"], staging / "traces")
            copy_tree(paths(root)["article_media"], staging / "article-media")
            (staging / ".lifecycle").mkdir(mode=0o700)
            shutil.copy2(root / ".lifecycle" / "initialized.json", staging / ".lifecycle" / "initialized.json")
            recovery = root / ".lifecycle" / "recovery"
            if recovery.exists():
                copy_tree(recovery, staging / ".lifecycle" / "recovery")
            files = manifest_files(staging)
            backup_id = uuid.uuid4().hex
            manifest = {
                "version": FORMAT,
                "backup_id": backup_id,
                "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "content_head": ready["head"],
                "control": ready["control"],
                "evidence": ready["evidence"],
                "files": files,
            }
            atomic_write(staging / "backup-manifest.json", canonical_json(manifest))
            temporary_archive = destination.parent / f".{destination.name}.{uuid.uuid4().hex}.tmp"
            try:
                temporary_descriptor = os.open(
                    temporary_archive,
                    os.O_RDWR | os.O_CREAT | os.O_EXCL,
                    0o600,
                )
                with os.fdopen(temporary_descriptor, "w+b") as archive_file:
                    before = os.fstat(archive_file.fileno())
                    with tarfile.open(fileobj=archive_file, mode="w:gz", format=tarfile.PAX_FORMAT) as archive:
                        def normalize(info: tarfile.TarInfo):
                            info.uid = info.gid = 0
                            info.uname = info.gname = ""
                            return info
                        for name in sorted(entry.name for entry in staging.iterdir()):
                            archive.add(staging / name, arcname=name, recursive=True, filter=normalize)
                    archive_file.flush()
                    os.fsync(archive_file.fileno())
                    after = os.fstat(archive_file.fileno())
                    named = temporary_archive.lstat()
                    if (
                        stat.S_IMODE(after.st_mode) != 0o600
                        or before.st_dev != after.st_dev
                        or before.st_ino != after.st_ino
                        or after.st_dev != named.st_dev
                        or after.st_ino != named.st_ino
                    ):
                        raise LifecycleError("UNSAFE_ARCHIVE", "Temporary backup inode or permissions changed")
                    archive_file.seek(0)
                    digest = hashlib.sha256()
                    for chunk in iter(lambda: archive_file.read(1024 * 1024), b""):
                        digest.update(chunk)
                    archive_digest = digest.hexdigest()
                    size = after.st_size
                try:
                    os.link(temporary_archive, destination, follow_symlinks=False)
                except FileExistsError as error:
                    raise LifecycleError("DESTINATION_EXISTS", f"Refusing to replace {destination}", 3) from error
                temporary_archive.unlink()
                sync_directory(destination.parent)
            finally:
                temporary_archive.unlink(missing_ok=True)
        print(json.dumps({
            "state": "backed-up", "backup_id": backup_id, "archive": str(destination),
            "sha256": archive_digest, "bytes": size, "content_head": ready["head"],
            "control": ready["control"], "evidence": ready["evidence"],
        }, sort_keys=True))


def safe_member_name(name: str) -> bool:
    pure = PurePosixPath(name)
    if pure.is_absolute() or not pure.parts or any(part in {"", ".", ".."} for part in pure.parts):
        return False
    first = pure.parts[0]
    if first == "backup-manifest.json":
        return len(pure.parts) == 1
    if first in {"content", "control", "traces", "article-media"}:
        return True
    if first == ".lifecycle":
        return len(pure.parts) == 1 or (
            (len(pure.parts) == 2 and pure.parts[1] == "initialized.json")
            or (len(pure.parts) >= 2 and pure.parts[1] == "recovery")
        )
    return False


def archive_inventory(archive: tarfile.TarFile) -> tuple[dict[str, tarfile.TarInfo], dict]:
    members = {}
    for item in archive.getmembers():
        if not safe_member_name(item.name) or item.name in members:
            raise LifecycleError("UNSAFE_ARCHIVE", f"Unsafe or duplicate archive path: {item.name}")
        if not (item.isdir() or item.isreg()) or item.issym() or item.islnk():
            raise LifecycleError("UNSAFE_ARCHIVE", f"Archive links and special files are forbidden: {item.name}")
        if item.mode & 0o7000:
            raise LifecycleError("UNSAFE_ARCHIVE", f"Archive special permission bits are forbidden: {item.name}")
        members[item.name] = item
    info = members.get("backup-manifest.json")
    if not info or not info.isreg():
        raise LifecycleError("INVALID_BACKUP", "Backup manifest is missing")
    source = archive.extractfile(info)
    if source is None:
        raise LifecycleError("INVALID_BACKUP", "Backup manifest is unreadable")
    try:
        manifest = json.load(source)
    except ValueError as error:
        raise LifecycleError("INVALID_BACKUP", "Backup manifest is invalid JSON") from error
    if manifest.get("version") != FORMAT or not isinstance(manifest.get("files"), dict):
        raise LifecycleError("INVALID_BACKUP", "Unsupported backup manifest")
    if (
        not isinstance(manifest.get("backup_id"), str)
        or not manifest["backup_id"]
        or not isinstance(manifest.get("content_head"), str)
        or len(manifest["content_head"]) != 40
        or any(character not in "0123456789abcdef" for character in manifest["content_head"])
    ):
        raise LifecycleError("INVALID_BACKUP", "Backup identity or Git HEAD is invalid")
    evidence = manifest.get("evidence", LOCAL_EVIDENCE)
    try:
        evidence = evidence_config({"evidence": evidence})
    except LifecycleError as error:
        raise LifecycleError("INVALID_BACKUP", "Backup evidence ownership is invalid") from error
    manifest["evidence"] = evidence
    regular = {name for name, item in members.items() if item.isreg() and name != "backup-manifest.json"}
    if regular != set(manifest["files"]):
        raise LifecycleError("INVALID_BACKUP", "Backup members do not match the manifest")
    required = {".lifecycle/initialized.json", "control/control.sqlite3"}
    if not required.issubset(regular):
        raise LifecycleError("INVALID_BACKUP", "Backup omits required state")
    for name in sorted(regular):
        expected = manifest["files"].get(name)
        item = members[name]
        if (
            not isinstance(expected, dict)
            or not isinstance(expected.get("sha256"), str)
            or len(expected["sha256"]) != 64
            or expected.get("size") != item.size
            or expected.get("mode") != item.mode
        ):
            raise LifecycleError("INVALID_BACKUP", f"Backup metadata mismatch: {name}")
        source = archive.extractfile(item)
        if source is None:
            raise LifecycleError("INVALID_BACKUP", f"Backup member unreadable: {name}")
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
        if digest.hexdigest() != expected.get("sha256"):
            raise LifecycleError("INVALID_BACKUP", f"Backup digest mismatch: {name}")
    return members, manifest


def extract_validated(archive: tarfile.TarFile, members: dict[str, tarfile.TarInfo], target: Path) -> None:
    for name in sorted(members, key=lambda value: (len(PurePosixPath(value).parts), value)):
        if name == "backup-manifest.json":
            continue
        item = members[name]
        destination = target.joinpath(*PurePosixPath(name).parts)
        if item.isdir():
            destination.mkdir(mode=item.mode, parents=True, exist_ok=True)
            os.chmod(destination, item.mode)
        else:
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            source = archive.extractfile(item)
            if source is None:
                raise LifecycleError("INVALID_BACKUP", f"Backup member unreadable: {name}")
            descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, item.mode)
            with os.fdopen(descriptor, "wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(destination, item.mode)


def validate_staging(staging: Path, manifest: dict) -> None:
    content = staging / "content"
    validate_git_structure(content)
    head = git(content, ["rev-parse", "HEAD"])
    if head != manifest.get("content_head"):
        raise LifecycleError("INVALID_BACKUP", "Backup Git HEAD does not match its manifest")
    git(content, ["fsck", "--no-dangling"])
    if git(content, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]):
        raise LifecycleError("INVALID_BACKUP", "Backup content worktree is not clean")
    validate_sqlite(staging / "control" / "control.sqlite3")
    value = read_json(staging / ".lifecycle" / "initialized.json")
    if not value or value.get("version") != FORMAT or value.get("layout") != LAYOUT:
        raise LifecycleError("INVALID_BACKUP", "Backup initialized marker is invalid")
    try:
        evidence = evidence_config(value)
    except LifecycleError as error:
        raise LifecycleError("INVALID_BACKUP", "Backup initialized evidence ownership is invalid") from error
    if evidence != manifest["evidence"]:
        raise LifecycleError("INVALID_BACKUP", "Backup evidence ownership does not match its marker")
    if not (staging / "article-media").is_dir():
        raise LifecycleError("INVALID_BACKUP", "Backup article-media directory is missing")
    traces = staging / "traces"
    if evidence["mode"] == "local" and not traces.is_dir():
        raise LifecycleError("INVALID_BACKUP", "Local-evidence backup omits traces")
    if evidence["mode"] == "external" and traces.exists():
        raise LifecycleError("INVALID_BACKUP", "External-evidence backup must not archive traces")


def restore(args) -> None:
    root = root_path(args.root, create=True)
    archive_path = ensure_external(root, Path(args.archive), "INVALID_ARCHIVE")
    if not archive_path.is_file() or archive_path.is_symlink():
        raise LifecycleError("INVALID_ARCHIVE", "Backup archive must be one regular file", 2)
    with ownership(root, "restore"):
        if (root / ".lifecycle" / "initialized.json").exists():
            raise LifecycleError("ALREADY_INITIALIZED", "Refusing to restore over initialized state", 3)
        extra_lifecycle = sorted(
            entry.name for entry in (root / ".lifecycle").iterdir()
            if entry.name not in {"owner.lock", "owner.json"}
        )
        if root_entries(root) or extra_lifecycle:
            raise LifecycleError("PARTIAL_STATE", "Restore target must be fresh and empty", 3)
        with tarfile.open(archive_path, "r:*") as archive:
            members, manifest = archive_inventory(archive)
            # Keep same-filesystem staging inside the writable state mount;
            # its parent can be the immutable container image.
            with tempfile.TemporaryDirectory(
                prefix=".restore-staging-", dir=root / ".lifecycle"
            ) as temporary:
                staging = Path(temporary) / "payload"
                staging.mkdir(mode=0o700)
                extract_validated(archive, members, staging)
                validate_staging(staging, manifest)
                stores = ["content", "control", "article-media"]
                if manifest["evidence"]["mode"] == "local":
                    stores.append("traces")
                for name in stores:
                    os.replace(staging / name, root / name)
                recovery = staging / ".lifecycle" / "recovery"
                if recovery.exists():
                    os.replace(recovery, root / ".lifecycle" / "recovery")
                sync_directory(root)
                marker_bytes = (staging / ".lifecycle" / "initialized.json").read_bytes()
            atomic_write(root / ".lifecycle" / "initialized.json", marker_bytes)
        ready = validate_ready(root)
        print(json.dumps({
            "state": "restored", "root": str(root), "backup_id": manifest["backup_id"],
            "archive_sha256": digest_file(archive_path), "content_head": ready["head"],
            "control": ready["control"], "evidence": ready["evidence"],
        }, sort_keys=True))


def lock_tree(lock: Path) -> dict:
    if not lock.is_dir() or lock.is_symlink():
        raise LifecycleError("INVALID_WRITER_LOCK", "Retained writer lock must be a directory")
    entries = []
    for current, directories, files in os.walk(lock, followlinks=False):
        directories.sort()
        current_path = Path(current)
        for name in sorted(directories):
            item = current_path / name
            details = item.lstat()
            if not stat.S_ISDIR(details.st_mode) or item.is_symlink():
                raise LifecycleError("INVALID_WRITER_LOCK", "Writer lock contains an unsafe entry")
            entries.append({"path": item.relative_to(lock).as_posix() + "/", "mode": stat.S_IMODE(details.st_mode)})
        for name in sorted(files):
            item = current_path / name
            details = item.lstat()
            if not stat.S_ISREG(details.st_mode) or item.is_symlink():
                raise LifecycleError("INVALID_WRITER_LOCK", "Writer lock contains an unsafe entry")
            entries.append({
                "path": item.relative_to(lock).as_posix(), "mode": stat.S_IMODE(details.st_mode),
                "size": details.st_size, "sha256": digest_file(item),
            })
    owner = read_json(lock / "owner.json")
    tree = digest_bytes(canonical_json(entries))
    return {"tree_sha256": tree, "entries": entries, "owner_valid": isinstance(owner, dict), "owner": owner}


def recovery_facts(root: Path) -> dict:
    marker(root)
    content = paths(root)["content"]
    validate_git_structure(content)
    lock = writer_lock(root)
    if not lock.exists():
        raise LifecycleError("NO_INTERRUPTED_WRITE", "No retained wiki-write.lock.d exists", 3)
    status = git_bytes(content, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    git(content, ["fsck", "--no-dangling"])
    return {
        "version": FORMAT,
        "root": str(root),
        "head": git(content, ["rev-parse", "HEAD"]),
        "worktree_clean": not status,
        "worktree_status_sha256": digest_bytes(status),
        "writer_lock": lock_tree(lock),
    }


def inspect_recovery(args) -> None:
    root = root_path(args.root)
    output = ensure_external(root, Path(args.output), "INVALID_MANIFEST")
    if output.exists() or output.is_symlink():
        raise LifecycleError("DESTINATION_EXISTS", f"Refusing to replace {output}", 3)
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with ownership(root, "inspect-recovery"):
        facts = recovery_facts(root)
        document = {
            "kind": "agent-wiki-interrupted-write-recovery",
            "inspected_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "facts": facts,
        }
        document["manifest_sha256"] = digest_bytes(canonical_json(document))
        atomic_write(output, canonical_json(document))
        print(json.dumps({
            "state": "inspected", "manifest": str(output), "manifest_sha256": document["manifest_sha256"],
            "head": facts["head"], "worktree_clean": facts["worktree_clean"],
            "writer_lock_sha256": facts["writer_lock"]["tree_sha256"],
            "owner_valid": facts["writer_lock"]["owner_valid"],
        }, sort_keys=True))


def recover(args) -> None:
    root = root_path(args.root)
    manifest_path = ensure_external(root, Path(args.manifest), "INVALID_MANIFEST")
    document = read_json(manifest_path)
    if not document or document.get("kind") != "agent-wiki-interrupted-write-recovery":
        raise LifecycleError("INVALID_MANIFEST", "Recovery manifest is invalid", 2)
    claimed = document.get("manifest_sha256")
    unsigned = dict(document)
    unsigned.pop("manifest_sha256", None)
    if claimed != digest_bytes(canonical_json(unsigned)):
        raise LifecycleError("INVALID_MANIFEST", "Recovery manifest digest is invalid", 2)
    with ownership(root, "recover"):
        current = recovery_facts(root)
        if current != document.get("facts"):
            raise LifecycleError("RECOVERY_DRIFT", "Writer lock, Git HEAD, or worktree changed after inspection", 3)
        if not current["worktree_clean"]:
            raise LifecycleError("WORKTREE_CONFLICT", "Reconcile the worktree, then create a new recovery manifest", 3)
        lock = writer_lock(root)
        shutil.rmtree(lock)
        receipt = {
            "version": FORMAT,
            "state": "recovered",
            "recovered_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "manifest_sha256": claimed,
            "writer_lock_sha256": current["writer_lock"]["tree_sha256"],
            "content_head": current["head"],
        }
        atomic_write(root / ".lifecycle" / "recovery" / f"{claimed}.json", canonical_json(receipt))
        validate_ready(root)
        print(json.dumps(receipt, sort_keys=True))


def status(args) -> None:
    root = root_path(args.root)
    active = False
    descriptor = open_lock(root)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            active = True
    finally:
        os.close(descriptor)
    initialized = read_json(root / ".lifecycle" / "initialized.json")
    result = {
        "state": "ready" if initialized else ("partial" if root_entries(root) else "uninitialized"),
        "root": str(root),
        "active_owner": active,
        "owner": read_json(root / ".lifecycle" / "owner.json"),
        "owner_is_diagnostic_only": True,
        "initialized": initialized,
    }
    if initialized:
        try:
            ready = validate_ready(root, allow_writer_lock=True)
            result["content_head"] = ready["head"]
            result["evidence"] = ready["evidence"]
            result["writer_recovery_required"] = writer_lock(root).exists()
        except Exception as error:
            result["state"] = "invalid"
            result["error"] = str(error)
    print(json.dumps(result, sort_keys=True))


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    subcommands = command.add_subparsers(dest="subcommand", required=True)
    boot = subcommands.add_parser("bootstrap", help="initialize one empty managed root")
    boot.add_argument("--root", required=True)
    boot.add_argument("--origin", required=True)
    boot.add_argument("--manager-email", required=True)
    boot.add_argument("--manager-name", required=True)
    boot.add_argument("--git-name", default="Agent Wiki")
    boot.add_argument("--git-email", default="agent-wiki@example.invalid")
    boot.add_argument("--external-evidence-url")
    boot.add_argument("--node", default="node")
    boot.set_defaults(function=bootstrap)
    import_existing = subcommands.add_parser("adopt", help="adopt validated existing content and control state")
    import_existing.add_argument("--root", required=True)
    import_existing.add_argument("--origin", required=True)
    import_existing.add_argument("--external-evidence-url")
    import_existing.set_defaults(function=adopt)
    start = subcommands.add_parser("serve", help="run the single managed server owner")
    start.add_argument("--root", required=True)
    start.add_argument("--origin")
    start.add_argument("--bind")
    start.add_argument("--port", type=int)
    start.add_argument("--node", default="node")
    start.set_defaults(function=serve)
    admin = subcommands.add_parser("maintenance", help="run one fenced offline command")
    admin.add_argument("--root", required=True)
    admin.add_argument("command", nargs=argparse.REMAINDER)
    admin.set_defaults(function=maintenance)
    save = subcommands.add_parser("backup", help="create a verified recovery archive")
    save.add_argument("--root", required=True)
    save.add_argument("--destination", required=True)
    save.set_defaults(function=backup)
    load = subcommands.add_parser("restore", help="restore into one fresh root")
    load.add_argument("--root", required=True)
    load.add_argument("--archive", required=True)
    load.set_defaults(function=restore)
    inspect = subcommands.add_parser("inspect-recovery", help="bind retained writer evidence to Git state")
    inspect.add_argument("--root", required=True)
    inspect.add_argument("--output", required=True)
    inspect.set_defaults(function=inspect_recovery)
    repair = subcommands.add_parser("recover", help="remove exactly inspected interrupted-write evidence")
    repair.add_argument("--root", required=True)
    repair.add_argument("--manifest", required=True)
    repair.set_defaults(function=recover)
    report = subcommands.add_parser("status", help="report managed lifecycle state")
    report.add_argument("--root", required=True)
    report.set_defaults(function=status)
    return command


def main() -> int:
    try:
        args = parser().parse_args()
        args.function(args)
        return 0
    except LifecycleError as error:
        print(json.dumps({"state": "rejected", "code": error.code, "error": str(error)}, sort_keys=True), file=sys.stderr)
        return error.exit_code
    except (OSError, subprocess.CalledProcessError, sqlite3.Error, tarfile.TarError) as error:
        detail = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) and error.stderr else str(error)
        print(json.dumps({"state": "failed", "code": "LIFECYCLE_FAILED", "error": detail}, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
