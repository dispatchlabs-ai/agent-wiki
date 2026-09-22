#!/usr/bin/env python3
"""Qualify OCI adoption of synthetic direct-storage Wiki state on Linux Docker.

The fixture is entirely disposable. The legacy image initializes only its
synthetic control database; this script never reads an operator Wiki, credentials,
SSH configuration, trace archive, or container. The HTTPS origin models the proxy
contract while requests reach a loopback-published backend port.
"""

from __future__ import annotations

import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.cookies
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


ORIGIN = "https://wiki-adoption.qualification.invalid"
EMAIL = "manager@example.invalid"
EVIDENCE_ID = "chat-" + "a" * 24
EVIDENCE_TEXT = "Synthetic external evidence survived container adoption."


class EvidenceHandler(BaseHTTPRequestHandler):
    requests: list[str] = []

    def log_message(self, _format, *_arguments):
        return

    def json_response(self, status: int, value: object) -> None:
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        url = urllib.parse.urlsplit(self.path)
        self.requests.append(url.path + ("?" + url.query if url.query else ""))
        base = "/api/evidence/v1/"
        if not url.path.startswith(base):
            self.json_response(404, {"error": "missing"})
            return
        route = url.path[len(base):]
        hit = {
            "id": EVIDENCE_ID,
            "title": "Synthetic adoption evidence",
            "machine": "synthetic-host",
            "format": "codex",
            "harness": "codex",
            "start": "2026-09-22T12:00:00Z",
            "end": "2026-09-22T12:01:00Z",
            "url": f"/conversations/{EVIDENCE_ID}/",
            "snippet": EVIDENCE_TEXT,
        }
        if route == "health":
            self.json_response(200, {"state": "ready", "conversations": 1})
            return
        if route == "search":
            self.json_response(
                200,
                {"indexed": True, "total": 1, "results": [hit], "nextOffset": None},
            )
            return
        if route == "catalog":
            self.json_response(200, {"total": 1, "items": [hit], "nextOffset": None})
            return
        if route == f"traces/{EVIDENCE_ID}":
            query = urllib.parse.parse_qs(url.query)
            kind = query.get("kind", ["dialogue"])[0]
            limit = int(query.get("limit", ["100"])[0])
            offset = int(query.get("offset", ["0"])[0])
            messages = []
            if kind == "dialogue" and offset == 0:
                messages = [
                    {
                        "id": "synthetic-event",
                        "aliases": [],
                        "kind": "dialogue",
                        "role": "assistant",
                        "text": EVIDENCE_TEXT,
                        "timestamp": "2026-09-22T12:00:01Z",
                        "line": 1,
                        "snapshot": "b" * 64,
                        "inherited": False,
                        "rolled_back": False,
                        "attachments": [],
                    }
                ][:limit]
            self.json_response(
                200,
                {
                    **hit,
                    "kind": kind,
                    "offset": offset,
                    "limit": limit,
                    "total": 1 if kind == "dialogue" else 0,
                    "nextOffset": None,
                    "previousOffset": None,
                    "counts": {"dialogue": 1},
                    "messages": messages,
                    "eventFound": None,
                    "related": {"siblings": [], "relations": []},
                },
            )
            return
        self.json_response(404, {"error": "missing"})


def chown_tree(root: Path, uid: int, gid: int) -> None:
    os.chown(root, uid, gid)
    for current, directories, files in os.walk(root):
        for name in directories:
            os.chown(Path(current) / name, uid, gid)
        for name in files:
            os.chown(Path(current) / name, uid, gid)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-image", required=True)
    parser.add_argument("--candidate-image", required=True)
    parser.add_argument("--legacy-version", default="0.8.8")
    parser.add_argument("--candidate-version", default="0.8.10")
    parser.add_argument("--uid", type=int, default=os.getuid())
    parser.add_argument("--gid", type=int, default=os.getgid())
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--keep-fixture", action="store_true")
    args = parser.parse_args()
    if args.uid == 0 or args.gid == 0:
        parser.error("Select a non-root fixture UID and GID")
    if not shutil.which("docker") or not shutil.which("git"):
        parser.error("Docker with Compose and Git are required")

    receipt_path = Path(args.receipt).resolve()
    if receipt_path.exists():
        parser.error("Receipt already exists")
    fixture = Path(tempfile.mkdtemp(prefix="agent-wiki-adoption-qualification-"))
    os.chmod(fixture, 0o700)
    project = "agent-wiki-adoption-" + uuid.uuid4().hex[:12]
    compose_path = fixture / "compose.json"
    password = "Synthetic-" + secrets.token_hex(24)
    receipt = {
        "schema": 1,
        "result": "running",
        "checks": {},
        "qualifier_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "limitations": [
            "SSH alias syntax is adopted, but this qualifier does not start an SSH server or exercise a push."
        ],
        "project": project,
        "fixture_retained": True,
    }
    started = time.monotonic()
    evidence = ThreadingHTTPServer(("127.0.0.1", 0), EvidenceHandler)
    EvidenceHandler.requests = []
    evidence_thread = threading.Thread(target=evidence.serve_forever, daemon=True)
    evidence_thread.start()
    evidence_url = (
        f"http://127.0.0.1:{evidence.server_address[1]}"
        "/api/evidence/v1/"
    )

    def command(argv: list[str], *, accepted: bool = True, env=None):
        result = subprocess.run(argv, capture_output=True, text=True, env=env)
        if accepted and result.returncode:
            log = fixture / ("failed-" + uuid.uuid4().hex + ".log")
            log.write_text(result.stdout + "\n" + result.stderr)
            log.chmod(0o600)
            raise RuntimeError("Command failed; inspect private fixture log " + str(log))
        return result

    synthetic_git_env = {
        **os.environ,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_TERMINAL_PROMPT": "0",
    }

    def host_git(*arguments: str):
        return command(["git", *arguments], env=synthetic_git_env)

    def docker(*arguments: str, accepted: bool = True, env=None):
        return command(["docker", *arguments], accepted=accepted, env=env)

    def compose(*arguments: str, accepted: bool = True):
        return docker(
            "compose",
            "-p",
            project,
            "-f",
            str(compose_path),
            *arguments,
            accepted=accepted,
        )

    def image(ref: str, expected_version: str) -> dict:
        value = json.loads(docker("image", "inspect", ref).stdout)[0]
        labels = value["Config"].get("Labels") or {}
        actual = labels.get("org.opencontainers.image.version")
        if actual != expected_version:
            raise RuntimeError(
                f"Expected image version {expected_version}, received {actual or 'unlabeled'}"
            )
        return {
            "id": value["Id"],
            "version": actual,
            "source": labels.get("org.opencontainers.image.revision"),
            "entrypoint": value["Config"]["Entrypoint"][0],
        }

    legacy = image(args.legacy_image, args.legacy_version)
    candidate = image(args.candidate_image, args.candidate_version)
    if legacy["id"] == candidate["id"]:
        parser.error("Legacy and candidate images must differ")
    receipt["legacy_image"] = {key: legacy[key] for key in ("id", "version", "source")}
    receipt["candidate_image"] = {
        key: candidate[key] for key in ("id", "version", "source")
    }

    legacy_root = fixture / "legacy"
    content = legacy_root / "content"
    control = legacy_root / "control"
    managed = fixture / "managed"
    restored = fixture / "restored"
    backup = fixture / "backup"
    for directory in (content, control, managed, restored, backup):
        directory.mkdir(parents=True, mode=0o700)
    article = content / "wiki" / "legacy-proof.md"
    article.parent.mkdir()
    article.write_text(
        "---\n"
        "title: Legacy proof\n"
        "description: Synthetic direct-storage content for adoption\n"
        "topic: Qualification\n"
        "---\n\n"
        "This article predates the managed root.\n"
    )
    host_git("-C", str(content), "init", "-b", "main")
    host_git("-C", str(content), "config", "user.name", "Synthetic Wiki")
    host_git("-C", str(content), "config", "user.email", "wiki@example.invalid")
    host_git(
        "-C",
        str(content),
        "remote",
        "add",
        "origin",
        "synthetic-host:/srv/synthetic/wiki-content.git",
    )
    host_git("-C", str(content), "add", "wiki/legacy-proof.md")
    host_git("-C", str(content), "commit", "-m", "Create synthetic legacy content")
    legacy_head = host_git("-C", str(content), "rev-parse", "HEAD").stdout.strip()
    for directory in (content, control, managed, restored, backup):
        chown_tree(directory, args.uid, args.gid)

    direct_bootstrap = str(
        Path(legacy["entrypoint"]).with_name("agent-wiki-bootstrap-direct")
    )
    bootstrap_env = dict(os.environ)
    bootstrap_env["WIKI_BOOTSTRAP_PASSWORD"] = password
    boot = docker(
        "run",
        "--rm",
        "--read-only",
        "--user",
        f"{args.uid}:{args.gid}",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,mode=1777",
        "--entrypoint",
        direct_bootstrap,
        "-e",
        "WIKI_BOOTSTRAP_PASSWORD",
        "-e",
        "WIKI_CONTROL=/state/control.sqlite3",
        "-v",
        f"{control}:/state",
        legacy["id"],
        EMAIL,
        "Synthetic manager",
        env=bootstrap_env,
    )
    principal = json.loads(boot.stdout)["principal"]
    receipt["checks"]["legacy_image_initialized_direct_control"] = True

    search = managed / "search"
    search.mkdir(mode=0o700)
    os.chown(search, args.uid, args.gid)

    # Exercise the Linux host-network contract used for an existing loopback
    # evidence provider without exposing a fixture server to the LAN or changing
    # firewall policy to permit Docker bridge traffic into the host.
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        backend_port = reservation.getsockname()[1]
    services = {
        "wiki": {
            "image": candidate["id"],
            "pull_policy": "never",
            "user": f"{args.uid}:{args.gid}",
            "init": True,
            "read_only": True,
            "cap_drop": ["ALL"],
            "security_opt": ["no-new-privileges:true"],
            "tmpfs": ["/tmp:rw,nosuid,nodev,mode=1777"],
            "stop_grace_period": "120s",
            "logging": {"driver": "none"},
            "network_mode": "host",
            "command": ["serve", "--root", "/data", "--bind", "127.0.0.1", "--port", str(backend_port)],
            "environment": {
                "WIKI_LOCAL_LOGIN": "1",
                "WIKI_WRITE": "1",
                "WIKI_PUSH": "0",
                "WIKI_DATABASE": "/data/search/wiki.sqlite3",
                "GIT_AUTHOR_NAME": "Synthetic Wiki",
                "GIT_AUTHOR_EMAIL": "wiki@example.invalid",
                "GIT_COMMITTER_NAME": "Synthetic Wiki",
                "GIT_COMMITTER_EMAIL": "wiki@example.invalid",
            },
            "volumes": [],
        }
    }

    def bind(source: Path, target: str) -> dict:
        return {
            "type": "bind",
            "source": str(source),
            "target": target,
            "bind": {"create_host_path": False},
        }

    def use_adopted_layout() -> None:
        services["wiki"]["volumes"] = [
            bind(managed, "/data"),
            bind(content, "/data/content"),
            bind(control, "/data/control"),
            bind(backup, "/backup"),
        ]

    def use_restored_layout() -> None:
        services["wiki"]["volumes"] = [
            bind(restored, "/data"),
            bind(backup, "/backup"),
        ]

    def write_compose() -> None:
        compose_path.write_text(json.dumps({"services": services}, indent=2))
        compose_path.chmod(0o600)

    def inspection() -> dict:
        container = compose("ps", "-a", "-q", "wiki").stdout.strip()
        return json.loads(docker("inspect", container).stdout)[0]

    def request(path: str, *, payload=None, cookie=None, csrf=None):
        headers = {
            "Host": "wiki-adoption.qualification.invalid",
            "Accept": "application/json, text/event-stream",
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
            headers["Origin"] = ORIGIN
            if path == "/mcp":
                headers["MCP-Protocol-Version"] = "2025-03-26"
        if cookie:
            headers["Cookie"] = cookie
        if csrf:
            headers["X-Wiki-CSRF"] = csrf
        request_value = urllib.request.Request(
            f"http://127.0.0.1:{backend_port}{path}",
            headers=headers,
            data=None if payload is None else json.dumps(payload).encode(),
        )
        try:
            response = urllib.request.urlopen(request_value, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read().decode()

    def cookies(headers) -> http.cookies.SimpleCookie:
        result = http.cookies.SimpleCookie()
        for line in headers.get_all("Set-Cookie", []):
            result.load(line)
        return result

    def wait_ready() -> None:
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            try:
                if request("/healthz")[0] == 200:
                    return
            except (OSError, TimeoutError):
                pass
            time.sleep(0.1)
        raise RuntimeError("Wiki did not reach health readiness")

    def login():
        status, headers, _ = request("/auth/local/setup")
        assert status == 200
        form = cookies(headers)["wiki_form"].value
        status, headers, _ = request(
            "/auth/local/login",
            cookie="wiki_form=" + form,
            csrf=form,
            payload={"email": EMAIL, "password": password},
        )
        assert status == 200
        cookie = "wiki_session=" + cookies(headers)["wiki_session"].value
        status, _, body = request("/api/me", cookie=cookie)
        assert status == 200
        profile = json.loads(body)
        return cookie, profile["csrf"], profile["id"]

    def wiki_call(name: str, arguments: dict, cookie: str, csrf: str) -> dict:
        status, _, body = request(
            "/mcp",
            cookie=cookie,
            csrf=csrf,
            payload={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            },
        )
        if body.startswith("event:") or body.startswith("data:"):
            body = next(line[6:] for line in body.splitlines() if line.startswith("data: "))
        result = json.loads(body)
        assert status == 200 and not result.get("error")
        assert not result["result"].get("isError")
        text = next(
            block["text"]
            for block in result["result"]["content"]
            if block["type"] == "text"
        )
        return json.loads(text)

    use_adopted_layout()
    write_compose()
    succeeded = False
    try:
        compose("config", "--quiet")
        adopted = json.loads(
            compose(
                "run",
                "--rm",
                "--no-deps",
                "wiki",
                "adopt",
                "--root",
                "/data",
                "--origin",
                ORIGIN,
                "--external-evidence-url",
                evidence_url,
            ).stdout
        )
        assert adopted["state"] == "adopted" and adopted["content_head"] == legacy_head
        marker = json.loads((managed / ".lifecycle" / "initialized.json").read_text())
        assert marker["evidence"] == {"mode": "external", "url": evidence_url}
        assert not (managed / "traces").exists()
        current_head = host_git(
            "-c", f"safe.directory={content}", "-C", str(content), "rev-parse", "HEAD"
        ).stdout.strip()
        assert current_head == legacy_head
        receipt["checks"]["adopt_preserved_git_control_and_external_descriptor"] = True
        receipt["checks"]["safe_scp_alias_accepted_without_push"] = True

        compose("up", "-d", "wiki")
        wait_ready()
        live = inspection()
        assert live["Config"]["User"] == f"{args.uid}:{args.gid}"
        assert live["HostConfig"]["ReadonlyRootfs"]
        cookie, csrf, authenticated = login()
        assert authenticated == principal
        assert "predates" in wiki_call("wiki.read", {"id": "legacy-proof"}, cookie, csrf)["body"]
        saved = wiki_call(
            "wiki.save",
            {
                "operation_id": "adoption-write",
                "updates": [
                    {
                        "id": "adopted-proof",
                        "expected_revision_id": None,
                        "title": "Adopted proof",
                        "description": "Synthetic adopted state remains writable",
                        "topic": "Qualification",
                        "body": "This write used the preserved manager identity.\n",
                        "summary": "Verify adopted write",
                    }
                ],
            },
            cookie,
            csrf,
        )
        assert saved["actor"] == principal and saved["remote"] == "not-requested"
        assert "preserved" in wiki_call("wiki.read", {"id": "adopted-proof"}, cookie, csrf)["body"]
        trace = wiki_call("wiki.trace", {"id": EVIDENCE_ID, "limit": 1}, cookie, csrf)
        assert trace["messages"][0]["text"] == EVIDENCE_TEXT
        assert any(f"traces/{EVIDENCE_ID}" in item for item in EvidenceHandler.requests)
        receipt["checks"]["authenticated_read_write_and_external_trace"] = True

        first_container = live["Id"]
        compose("stop", "wiki")
        assert inspection()["State"]["ExitCode"] != 137
        compose("up", "-d", "--no-deps", "--force-recreate", "wiki")
        wait_ready()
        assert inspection()["Id"] != first_container
        assert "preserved" in wiki_call("wiki.read", {"id": "adopted-proof"}, cookie, csrf)["body"]
        receipt["checks"]["container_recreation_preserved_session_identity_and_content"] = True

        compose("stop", "wiki")
        archive = backup / "adoption.tar.gz"
        backed_up = json.loads(
            compose(
                "run",
                "--rm",
                "--no-deps",
                "wiki",
                "backup",
                "--root",
                "/data",
                "--destination",
                "/backup/adoption.tar.gz",
            ).stdout
        )
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == backed_up["sha256"]
        receipt["backup_sha256"] = backed_up["sha256"]
        with tarfile.open(archive, "r:gz") as package:
            members = package.getnames()
            backup_manifest = json.load(package.extractfile("backup-manifest.json"))
        assert backup_manifest["evidence"] == {"mode": "external", "url": evidence_url}
        assert not any(name == "traces" or name.startswith("traces/") for name in members)
        receipt["checks"]["backup_excluded_external_evidence_and_recorded_descriptor"] = True

        use_restored_layout()
        write_compose()
        compose("config", "--quiet")
        restored_receipt = json.loads(
            compose(
                "run",
                "--rm",
                "--no-deps",
                "wiki",
                "restore",
                "--root",
                "/data",
                "--archive",
                "/backup/adoption.tar.gz",
            ).stdout
        )
        assert restored_receipt["evidence"] == {"mode": "external", "url": evidence_url}
        assert restored_receipt["content_head"] == backed_up["content_head"]
        assert not (restored / "traces").exists()
        restored_marker = json.loads((restored / ".lifecycle" / "initialized.json").read_text())
        assert restored_marker["evidence"] == marker["evidence"]
        restored_search = restored / "search"
        restored_search.mkdir(mode=0o700)
        os.chown(restored_search, args.uid, args.gid)
        compose("up", "-d", "--force-recreate", "wiki")
        wait_ready()
        restored_cookie, restored_csrf, restored_principal = login()
        assert restored_principal == principal
        assert "preserved" in wiki_call(
            "wiki.read", {"id": "adopted-proof"}, restored_cookie, restored_csrf
        )["body"]
        restored_write = wiki_call(
            "wiki.save",
            {
                "operation_id": "restored-write",
                "updates": [
                    {
                        "id": "restored-proof",
                        "expected_revision_id": None,
                        "title": "Restored proof",
                        "description": "Synthetic restored state remains writable",
                        "topic": "Qualification",
                        "body": "The external-evidence restore remains writable.\n",
                        "summary": "Verify restored write",
                    }
                ],
            },
            restored_cookie,
            restored_csrf,
        )
        assert restored_write["actor"] == principal
        restored_trace = wiki_call(
            "wiki.trace", {"id": EVIDENCE_ID, "limit": 1}, restored_cookie, restored_csrf
        )
        assert restored_trace["messages"][0]["text"] == EVIDENCE_TEXT
        receipt["checks"]["fresh_restore_preserved_auth_writes_and_external_evidence"] = True
        receipt["result"] = "passed"
        succeeded = True
    except Exception as error:
        receipt["result"] = "failed"
        receipt["failure"] = repr(error)
        raise
    finally:
        compose("down", accepted=False)
        evidence.shutdown()
        evidence.server_close()
        evidence_thread.join(timeout=5)
        receipt["elapsed_ms"] = round((time.monotonic() - started) * 1000)
        receipt["fixture_retained"] = not (succeeded and not args.keep_fixture)
        if receipt["fixture_retained"]:
            receipt["fixture"] = str(fixture)
        receipt_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with receipt_path.open("x") as output:
            os.fchmod(output.fileno(), 0o600)
            json.dump(receipt, output, indent=2)
            output.write("\n")
        print(json.dumps(receipt, indent=2))
        if succeeded and not args.keep_fixture:
            shutil.rmtree(fixture)


if __name__ == "__main__":
    main()
