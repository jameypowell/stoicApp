#!/usr/bin/env python3
"""
Update environment variables in an ECS task definition.

This script updates the environment variables for a container in an ECS task definition
and registers a new revision. It then updates the service to use the new revision.

Usage:
    python scripts/update_ecs_env_vars.py --region us-east-1 --cluster stoic-fitness-app --service stoic-fitness-service --container stoic-fitness-app --env-file .env

Or set individual variables:
    python scripts/update_ecs_env_vars.py --region us-east-1 --cluster stoic-fitness-app --service stoic-fitness-service --container stoic-fitness-app --set NODE_ENV=production --set STRIPE_PUBLISHABLE_KEY=pk_test_...
"""

import argparse
import json
import sys
from typing import Dict, List, Optional

import boto3
from botocore.exceptions import ClientError


def parse_env_file(env_file: str) -> Dict[str, str]:
    """Parse a .env file and return a dictionary of key-value pairs."""
    env_vars = {}
    try:
        with open(env_file, 'r') as f:
            for line in f:
                line = line.strip()
                # Skip empty lines and comments
                if not line or line.startswith('#'):
                    continue
                # Parse KEY=VALUE format
                if '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    # Only include variables that should be in production
                    # Skip local-only variables like DB_PATH
                    if key not in ['DB_PATH', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']:
                        env_vars[key] = value
    except FileNotFoundError:
        print(f"⚠ Warning: Environment file {env_file} not found. Skipping.")
    except Exception as e:
        print(f"⚠ Warning: Error reading {env_file}: {e}. Skipping.")
    return env_vars


def parse_env_set(env_set: List[str]) -> Dict[str, str]:
    """Parse --set KEY=VALUE arguments."""
    env_vars = {}
    for item in env_set:
        if '=' not in item:
            print(f"⚠ Warning: Invalid format '{item}'. Expected KEY=VALUE. Skipping.")
            continue
        key, value = item.split('=', 1)
        env_vars[key.strip()] = value.strip()
    return env_vars


def get_current_task_definition(ecs_client, cluster: str, service: str) -> dict:
    """Get the current task definition for a service."""
    print(f"▶ Fetching current task definition for service {service}...")
    service_desc = ecs_client.describe_services(cluster=cluster, services=[service])
    services = service_desc.get("services", [])
    if not services:
        raise RuntimeError(f"Service {service} not found in cluster {cluster}.")
    
    current_td_arn = services[0]["taskDefinition"]
    td_desc = ecs_client.describe_task_definition(taskDefinition=current_td_arn)
    return td_desc["taskDefinition"]


def update_task_definition_env(task_definition: dict, container_name: str, new_env_vars: Dict[str, str], merge: bool = True) -> dict:
    """Update environment variables in a task definition."""
    # Create a deep copy
    import copy
    new_td = copy.deepcopy(task_definition)
    
    # Remove read-only fields
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
        new_td.pop(field, None)
    
    # Find the container
    containers = new_td.get("containerDefinitions", [])
    container = None
    for c in containers:
        if c["name"] == container_name:
            container = c
            break
    
    if not container:
        if not containers:
            raise RuntimeError("Task definition has no container definitions.")
        container = containers[0]
        print(f"⚠ Container '{container_name}' not found. Using first container '{container['name']}' instead.")
    
    # Update environment variables
    existing_env = {}
    if merge:
        # Get existing environment variables
        for env_var in container.get("environment", []):
            existing_env[env_var["name"]] = env_var["value"]
    
    # Merge with new variables
    existing_env.update(new_env_vars)
    
    # Set the environment array
    container["environment"] = [
        {"name": key, "value": value}
        for key, value in existing_env.items()
    ]
    
    return new_td


def main():
    parser = argparse.ArgumentParser(
        description="Update environment variables in an ECS task definition."
    )
    parser.add_argument("--region", default="us-east-1", help="AWS region")
    parser.add_argument("--cluster", default="stoic-fitness-app", help="ECS cluster name")
    parser.add_argument("--service", default="stoic-fitness-service", help="ECS service name")
    parser.add_argument("--container", default="stoic-fitness-app", help="Container name")
    parser.add_argument("--env-file", help="Path to .env file to read variables from")
    parser.add_argument("--set", action="append", help="Set a variable (KEY=VALUE). Can be used multiple times.")
    parser.add_argument("--no-merge", action="store_true", help="Replace all environment variables instead of merging")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be updated without making changes")
    args = parser.parse_args()
    
    # Collect environment variables
    env_vars = {}
    
    if args.env_file:
        env_vars.update(parse_env_file(args.env_file))
    
    if args.set:
        env_vars.update(parse_env_set(args.set))
    
    if not env_vars:
        print("❌ No environment variables provided. Use --env-file or --set.")
        sys.exit(1)
    
    print(f"▶ Updating environment variables: {', '.join(env_vars.keys())}")
    
    try:
        ecs = boto3.client("ecs", region_name=args.region)
        
        # Get current task definition
        current_td = get_current_task_definition(ecs, args.cluster, args.service)
        
        # Update environment variables
        new_td = update_task_definition_env(
            current_td,
            args.container,
            env_vars,
            merge=not args.no_merge
        )
        
        if args.dry_run:
            print("\n📋 Dry run - would update environment variables:")
            container = None
            for c in new_td.get("containerDefinitions", []):
                if c["name"] == args.container:
                    container = c
                    break
            if container:
                for env_var in container.get("environment", []):
                    if env_var["name"] in env_vars:
                        print(f"  {env_var['name']} = {env_var['value']}")
            print("\n⚠ Dry run only - no changes made.")
            return
        
        # Register new task definition
        print("▶ Registering new task definition revision...")
        register_resp = ecs.register_task_definition(**new_td)
        new_td_arn = register_resp["taskDefinition"]["taskDefinitionArn"]
        print(f"✅ Registered task definition: {new_td_arn}")
        
        # Update service
        print("▶ Updating ECS service...")
        ecs.update_service(
            cluster=args.cluster,
            service=args.service,
            taskDefinition=new_td_arn,
            forceNewDeployment=True,
        )
        print("✅ Service update triggered. New tasks will start with updated environment variables.")
        print("⏳ Wait a few minutes for the service to stabilize.")
        
    except ClientError as err:
        print(f"❌ AWS error: {err}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"❌ Error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()






