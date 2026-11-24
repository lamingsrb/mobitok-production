"""Build a public snapshot, upload it to Vercel, verify it, and optionally promote it."""

import argparse
import base64
import binascii
import json
import os
from pathlib import Path
import re
import subprocess
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen


REPOSITORY = "lamingsrb/mobitok-production"
ORIGIN = "https://mobitok.rs"
API = "https://api.vercel.com"
PROJECT_NAME = "my-home"
TEAM_SLUG = "mobitok"
SUPABASE_REF = "aysjbxkaeuglciktvcrh"
VERCEL_CLI = ["npx", "--yes", "vercel@54.9.1"]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def request(url, token=None, method="GET"):
    headers = {"User-Agent": "MOBITOK production publisher"}
    if token:
        headers["Authorization"] = "Bearer " + token
    with urlopen(Request(url, headers=headers, method=method), timeout=22) as response:
        payload = response.read()
        return json.loads(payload) if payload else None


def vercel(path, token, query=None, method="GET"):
    params = {"teamId": os.environ["VERCEL_ORG_ID"], **(query or {})}
    return request(f"{API}{path}?{urlencode(params)}", token, method)


def remote_sha():
    result = subprocess.check_output(
        ["git", "ls-remote", "--heads", f"https://github.com/{REPOSITORY}.git", "refs/heads/main"],
        text=True,
        timeout=20,
    )
    return result.split()[0]


def public_supabase_key():
    key = os.getenv("MOBITOK_PUBLIC_SUPABASE_ANON_KEY", "")
    if re.fullmatch(r"sb_publishable_[a-zA-Z0-9_-]+", key):
        return key
    if re.fullmatch(r"[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+", key):
        payload = key.split(".")[1]
        try:
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        except (binascii.Error, ValueError):
            claims = None
        if isinstance(claims, dict) and claims.get("role") == "anon" and claims.get("ref") == SUPABASE_REF:
            return key
    raise RuntimeError("Set MOBITOK_PUBLIC_SUPABASE_ANON_KEY to the public key for the production Supabase project")


def build(project, team):
    require(not os.getenv("VERCEL_TOKEN"), "The GitHub build must run without the Vercel token")
    build_env = {
        **os.environ,
        "NEXT_PUBLIC_SITE_URL": ORIGIN,
        "NEXT_PUBLIC_SUPABASE_URL": f"https://{SUPABASE_REF}.supabase.co",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY": public_supabase_key(),
    }
    # The pinned CLI accepts a local project settings file for an unauthenticated build.
    # These settings let the build run without pulling any Vercel environment variables.
    directory = Path(".vercel")
    directory.mkdir()
    (directory / "project.json").write_text(json.dumps({
        "projectId": project,
        "orgId": team,
        "projectName": PROJECT_NAME,
        "settings": {
            "framework": "nextjs",
            "nodeVersion": "24.x",
            "rootDirectory": None,
            "installCommand": "npm ci",
            "buildCommand": None,
            "devCommand": None,
            "outputDirectory": None,
            "directoryListing": False,
        },
    }), encoding="utf-8")
    try:
        completed = subprocess.run([*VERCEL_CLI, "build", "--prod", "--yes"], env=build_env, timeout=720)
    except subprocess.TimeoutExpired:
        raise TimeoutError("The GitHub production build exceeded 12 minutes") from None
    require(completed.returncode == 0, "The GitHub production build failed")
    require((directory / "output" / "config.json").is_file(), "Vercel Build Output API configuration is missing")


def candidates(project, token, sha):
    result = vercel("/v6/deployments", token, {"projectId": project, "limit": 30})
    return [
        item for item in result["deployments"]
        if item.get("meta", {}).get("sourceCommit") == sha
        and item.get("meta", {}).get("releaseWorkflow") == "mobitok-production"
        and item.get("meta", {}).get("releaseBuild") == "github-prebuilt"
        and item.get("target") == "production"
    ]


def verify_site(origin, sha):
    health = request(origin + "/api/health")
    require(health.get("status") == "ok" and health.get("commit") == sha
            and health.get("database") == "connected", "Health did not verify this commit and database")
    shop = request(origin + "/api/shop-mode")
    require(type(shop.get("preparationMode")) is bool, "Shop mode unavailable")
    methods = request(origin + "/api/payments/methods").get("methods", [])
    require(any(method.get("id") == "cod" for method in methods), "Payment methods unavailable")
    catalog = request(origin + "/api/catalog?velicina=1")
    require(catalog.get("total", 0) > 0 and bool(catalog.get("items")), "Catalog unavailable")


def deploy(sha, project, token):
    existing = candidates(project, token, sha)
    pending = next((item for item in existing if item["readyState"] in ("READY", "QUEUED", "BUILDING", "INITIALIZING")), None)
    if not pending:
        require(Path(".vercel/output/config.json").is_file(), "GitHub production build output is missing")
        try:
            completed = subprocess.run([
                *VERCEL_CLI, "deploy", "--prebuilt", "--prod", "--yes", "--skip-domain",
                "--no-wait", "--format", "json", "--env", f"APP_COMMIT_SHA={sha}",
                "--meta", f"sourceCommit={sha}", "--meta", "releaseWorkflow=mobitok-production",
                "--meta", "releaseBuild=github-prebuilt",
            ], capture_output=True, text=True, timeout=180)
        except subprocess.TimeoutExpired:
            print("Vercel CLI upload timed out; checking for an accepted deployment.", flush=True)
        else:
            if completed.returncode:
                print(f"Vercel CLI upload exited with status {completed.returncode}; checking for an accepted deployment.", flush=True)
    until = time.monotonic() + 660
    while time.monotonic() < until:
        matching = candidates(project, token, sha)
        if matching:
            entry = matching[0]
            status = entry["readyState"]
            if status == "READY":
                return vercel(f"/v13/deployments/{entry['uid']}", token)
            require(status not in ("BLOCKED", "ERROR", "CANCELED"), f"Vercel status {status}: {entry['uid']}")
        time.sleep(10)
    raise TimeoutError("Vercel did not report a ready deployment for the current commit")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("build", "deploy"))
    stage = parser.parse_args().stage
    sha = os.environ["GITHUB_SHA"]
    project = os.environ["VERCEL_PROJECT_ID"]
    team = os.environ["VERCEL_ORG_ID"]
    require(bool(re.fullmatch("[a-f0-9]{40}", sha)), "Invalid public Git SHA")
    require(bool(re.fullmatch("prj_[a-zA-Z0-9]+", project)), "Missing Vercel project ID")
    require(bool(re.fullmatch("team_[a-zA-Z0-9]+", team)), "Missing Vercel team ID")
    require(os.environ["GITHUB_REPOSITORY"] == REPOSITORY and os.environ["GITHUB_REF"] == "refs/heads/main",
            "Unexpected GitHub deploy target")
    require(Path(".production-files").is_file(), "Public code inventory is missing")
    require(subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() == sha, "Checkout SHA mismatch")
    if remote_sha() != sha:
        print("A newer public commit is already on main.", flush=True)
        return
    if stage == "build":
        build(project, team)
        return
    token = os.getenv("VERCEL_TOKEN")
    require(bool(token), "Missing Vercel deployment token")
    team_info = request(f"{API}/v2/teams/{team}", token)
    configuration = vercel(f"/v9/projects/{project}", token)
    require(team_info["slug"] == TEAM_SLUG and configuration["name"] == PROJECT_NAME
            and configuration["accountId"] == team, "Unexpected Vercel team or project")
    deployment = deploy(sha, project, token)
    require(deployment.get("readyState") == "READY" and deployment.get("target") == "production"
            and deployment.get("projectId") == project and deployment.get("meta", {}).get("sourceCommit") == sha
            and deployment.get("meta", {}).get("releaseBuild") == "github-prebuilt"
            and deployment.get("meta", {}).get("githubCommitSha") == sha, "Vercel deployment provenance did not match")
    host = deployment["url"]
    require(bool(re.fullmatch(r"my-home-[a-z0-9]+-mobitok\.vercel\.app", host)), "Unexpected Vercel candidate URL")
    verify_site("https://" + host, sha)
    deployment_id = deployment["id"]
    print(f"Verified {deployment_id} from public commit {sha}", flush=True)
    if os.getenv("MOBITOK_AUTO_PROMOTE") != "true":
        return
    if remote_sha() != sha:
        print("A newer public commit is already on main.", flush=True)
        return
    current = vercel(f"/v9/projects/{project}", token)
    if (current.get("targets", {}).get("production") or {}).get("id") != deployment_id:
        vercel(f"/v10/projects/{project}/promote/{deployment_id}", token, method="POST")
    for attempt in range(12):
        try:
            verify_site(ORIGIN, sha)
        except (RuntimeError, OSError):
            if attempt == 11:
                raise
            time.sleep(5)
        else:
            print(f"Live production verified on {sha}", flush=True)
            break


if __name__ == "__main__":
    main()
