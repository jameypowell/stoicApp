#!/usr/bin/env python3
"""
Automated deployment helper for Stoic Fitness production ECS service.

This script will:
  1. Build a linux/amd64 Docker image from the local source tree.
  2. Tag and push the image to the ECR repository.
  3. Register a new ECS task definition revision that references the new image.
  4. Update the ECS service and wait for it to stabilise.

Requirements:
  - Docker CLI installed and running.
  - AWS credentials configured with permissions to use ECR/ECS/STS.
  - boto3, jq not required (script uses Python only).

Usage example:
  python scripts/deploy_to_prod.py

You can override defaults such as region, cluster, service, etc. via CLI flags.
Run with --help for details.
"""

import argparse
import base64
import copy
import datetime
import subprocess
import sys
from typing import List, Optional

import boto3
from botocore.exceptions import ClientError


def run(cmd: List[str], *, allow_failure: bool = False, input_data: Optional[bytes] = None) -> subprocess.CompletedProcess:
    """Run a subprocess command, streaming output live."""
    process = subprocess.run(
        cmd,
        input=input_data,
        check=False,
        text=False,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    if process.returncode != 0 and not allow_failure:
        raise subprocess.CalledProcessError(process.returncode, cmd)
    return process


def docker_login(ecr_client, region: str) -> str:
    """Authenticate Docker CLI against the account's ECR registry."""
    auth = ecr_client.get_authorization_token()
    auth_data = auth["authorizationData"][0]
    token = base64.b64decode(auth_data["authorizationToken"]).decode("utf-8")
    password = token.split(":", 1)[1]
    registry = auth_data["proxyEndpoint"].replace("https://", "")
    run(
        ["docker", "login", "--username", "AWS", "--password-stdin", registry],
        input_data=password.encode("utf-8"),
    )
    return registry


def build_and_push_image(args, account_id: str) -> str:
    """Build, tag, and push the Docker image. Returns the full image URI."""
    tag = args.tag or datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")
    local_ref = f"{args.repository}:{tag}"
    full_image = f"{account_id}.dkr.ecr.{args.region}.amazonaws.com/{args.repository}:{tag}"

    if not args.skip_build:
        print(f"▶ Building Docker image {local_ref} ...")
        build_cmd = [
            "docker",
            "build",
            "--platform",
            "linux/amd64",
            "-t",
            local_ref,
            args.context,
        ]
        run(build_cmd)
    else:
        print("⚠ Skipping docker build as requested (--skip-build).")

    print(f"▶ Tagging image as {full_image}")
    run(["docker", "tag", local_ref, full_image])

    print("▶ Pushing image to ECR (this may take a moment) ...")
    run(["docker", "push", full_image])

    print(f"✅ Image pushed: {full_image}")
    return full_image


def create_task_definition_payload(task_definition: dict, new_image: str, container_name: str) -> dict:
    """Prepare a new task definition JSON payload with the updated image."""
    payload = copy.deepcopy(task_definition)
    for field in (
        "taskDefinitionArn",
        "revision",
        "status",
        "requiresAttributes",
        "compatibilities",
        "registeredAt",
        "registeredBy",
        "deregisteredAt",
    ):
        payload.pop(field, None)

    containers = payload.get("containerDefinitions", [])
    matched = False
    for container in containers:
        if container["name"] == container_name:
            container["image"] = new_image
            matched = True
            break

    if not matched:
        if not containers:
            raise RuntimeError("Task definition has no container definitions.")
        containers[0]["image"] = new_image
        print(
            f"⚠ Container named '{container_name}' not found. "
            f"Updated the first container ({containers[0]['name']}) instead."
        )
    return payload


def wait_for_service_stable(ecs_client, cluster: str, service: str, wait: bool) -> None:
    if not wait:
        print("⚠ Skipping wait for service stability (--no-wait).")
        return
    print("⏳ Waiting for service to become stable ...")
    waiter = ecs_client.get_waiter("services_stable")
    waiter.wait(
        cluster=cluster,
        services=[service],
        WaiterConfig={"Delay": 15, "MaxAttempts": 40},
    )
    print("✅ Service reported as stable.")


def main():
    parser = argparse.ArgumentParser(description="Deploy the Stoic Fitness app to production (ECS Fargate).")
    parser.add_argument("--region", default="us-east-1", help="AWS region (default: us-east-1)")
    parser.add_argument("--cluster", default="stoic-fitness-app", help="ECS cluster name")
    parser.add_argument("--service", default="stoic-fitness-service", help="ECS service name")
    parser.add_argument("--container-name", default="stoic-fitness-app", help="Container name inside the task definition to update")
    parser.add_argument("--repository", default="stoic-fitness-app", help="ECR repository name")
    parser.add_argument("--context", default=".", help="Docker build context (default: current directory)")
    parser.add_argument("--tag", help="Override image tag (default: timestamp)")
    parser.add_argument("--skip-build", action="store_true", help="Skip docker build step (useful if already built locally)")
    parser.add_argument("--no-wait", action="store_true", help="Do not wait for ECS service to stabilise")
    args = parser.parse_args()

    sts = boto3.client("sts", region_name=args.region)
    account_id = sts.get_caller_identity()["Account"]

    ecr = boto3.client("ecr", region_name=args.region)
    ecs = boto3.client("ecs", region_name=args.region)

    print("▶ Logging into ECR ...")
    registry = docker_login(ecr, args.region)
    print(f"✅ Docker authenticated to {registry}")

    full_image = build_and_push_image(args, account_id)

    print("▶ Fetching current service task definition ...")
    service_desc = ecs.describe_services(cluster=args.cluster, services=[args.service])
    services = service_desc.get("services", [])
    if not services:
        raise RuntimeError(f"Service {args.service} not found in cluster {args.cluster}.")

    current_td_arn = services[0]["taskDefinition"]
    td_desc = ecs.describe_task_definition(taskDefinition=current_td_arn)
    base_td = td_desc["taskDefinition"]

    new_payload = create_task_definition_payload(base_td, full_image, args.container_name)

    print("▶ Registering new task definition revision ...")
    register_resp = ecs.register_task_definition(**new_payload)
    new_td_arn = register_resp["taskDefinition"]["taskDefinitionArn"]
    print(f"✅ Registered task definition: {new_td_arn}")

    print("▶ Updating ECS service with new task definition ...")
    ecs.update_service(
        cluster=args.cluster,
        service=args.service,
        taskDefinition=new_td_arn,
        forceNewDeployment=True,
    )
    print("✅ Deployment triggered.")

    wait_for_service_stable(ecs, args.cluster, args.service, wait=not args.no_wait)
    print("🚀 Deployment complete.")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"❌ Command failed: {' '.join(exc.cmd)}", file=sys.stderr)
        sys.exit(exc.returncode)
    except ClientError as err:
        print(f"❌ AWS error: {err}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"❌ {exc}", file=sys.stderr)
        sys.exit(1)

