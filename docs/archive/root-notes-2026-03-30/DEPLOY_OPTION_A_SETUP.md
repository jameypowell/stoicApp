# Deploy Option A: Credentials on Host

Deploy runs on your machine using AWS and Docker installed locally. **No containers need to be running** for deploy to work.

## One-time setup

### 1. Install AWS CLI

- macOS: `brew install awscli`
- Or: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

### 2. Configure AWS credentials on your machine

Pick one:

**Option 2a – Interactive (recommended)**

```bash
aws configure
```

Enter:

- **AWS Access Key ID** – from IAM user (e.g. `stoic-fitness-app`)
- **AWS Secret Access Key**
- **Default region** – e.g. `us-east-1`
- **Default output** – e.g. `json`

**Option 2b – Environment variables**

Add to your shell profile (e.g. `~/.zshrc`) or a file you source:

```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_DEFAULT_REGION=us-east-1
```

(Do not commit these. Use a secrets manager or IAM role in CI.)

### 3. Install Docker

- Docker Desktop or Docker Engine: https://docs.docker.com/get-docker/

Docker must be running when you deploy (for build and push). No app containers need to be running.

### 4. Verify setup

From the project root:

```bash
./scripts/check-deploy-env.sh
```

You should see “Deploy environment OK”. If not, the script will report what’s missing.

## Deploy

From the project root, with no app containers required:

```bash
./deploy.sh
```

If you see “AWS credentials not configured or expired”, run `aws configure` again or check your env vars, then retry.

## Running the app locally (optional)

- **On host:** `npm start`
- **In Docker (single container):** `docker compose up -d` then open http://localhost:3000  
  Stop with: `docker compose down`

You do **not** need to start any containers for deploy.
