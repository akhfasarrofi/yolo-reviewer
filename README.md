# Yolo AI Reviewer

> Automated AI code review for GitLab & GitHub — self-host it as a server, run it in Docker, or drop it straight into your CI pipeline. No vendor lock-in.

Yolo acts as a tireless, automated code reviewer. When a developer opens a Pull Request or Merge Request, Yolo fetches the diff, reads your team's custom review standards (`.skills/`), sends them to an AI model, and posts inline comments directly on the changed lines — exactly like a senior engineer doing a code review.

---

## Why Yolo?

- 🔀 **Multi-platform** — Works with both **GitLab** and **GitHub** out of the box.
- 🧠 **AI Agnostic** — Bring your own AI: OpenAI, Anthropic, Gemini, or any self-hosted LLM (Ollama, etc).
- 🛡️ **Skill-Based Rules** — Each repository teaches Yolo what to look for via `.skills/` markdown files. No hardcoded rules.
- 🌿 **Per-Repo Configuration** — Each repo controls its own branch filters via `.yolo/config.yml`.
- 📨 **Telegram Alerts** — Get notified instantly for high-priority issues (e.g. security violations).
- 🔄 **Auto-Resolve** — Old comments are automatically resolved when the issue is fixed in a follow-up commit.
- 🚫 **Anti-Spam** — Cryptographic hashing prevents duplicate comments on the same line.
- ⚡ **Hot-Reload Config** — Edit `config.yml` while the server runs — no restart needed.
- 🐳 **Docker Ready** — Self-host with a single `docker compose up`.
- 🚀 **CI/CD Mode** — Run via `npx yolo-run` directly inside GitHub Actions or GitLab CI — no server needed.

---

## How It Works

```mermaid
sequenceDiagram
    actor Dev as 👨‍💻 Developer
    participant GL as 🦊 GitLab / 🐙 GitHub
    participant Yolo as ⚙️ Yolo Engine
    participant AI as 🧠 AI Model
    participant TG as 📨 Telegram

    Dev->>GL: Open / Update PR or MR

    alt Server / Docker Mode
        GL->>Yolo: Webhook event
    else CI/CD Mode
        GL->>Yolo: CI pipeline runs npx yolo-run
    end

    Yolo->>GL: Fetch .yolo/config.yml (branch filter)
    Yolo->>GL: Fetch changed file diffs
    Yolo->>GL: Fetch .skills/*.md (review rules)

    Yolo->>AI: Send diff + skill rules
    AI-->>Yolo: JSON comments (line, category, issue, suggestion)

    Yolo->>GL: Post inline comments on PR/MR diff

    opt category matches trigger_categories
        Yolo->>TG: Send alert message
    end
```

---

## Requirements

- [Bun](https://bun.sh) v1.0+ *(for server/docker mode)*
- GitLab or GitHub account
- An OpenAI-compatible AI endpoint (`/v1/chat/completions`)

---

## Deployment Modes

Yolo can run in three different ways. Pick the one that fits your team:

| Mode | Infrastructure | Best For |
|---|---|---|
| **Server (Webhook)** | Your own server / VPS | Teams with multiple repos |
| **Docker** | Docker on any server | Easy self-hosting |
| **CI/CD** | No server, runs in pipeline | Single repo or testing |

---

## Setup

### Step 1 — Install & Initialize

Run the interactive CLI to generate all configuration files:

```bash
npx yolo-ai-reviewer init
```

Follow the prompts:
1. Select platform: **GitLab** or **GitHub**
2. Enter credentials (token, URL, webhook secret)
3. Select AI provider and enter API key
4. Set AI model, temperature, language

**Generated files:**
- `.env` — credentials for your server
- `config.yml` — server-level AI behavior
- `.yolo/config.yml` — per-repo template (commit this to each target repo)

---

### Step 1.5 — Setup Bot Account (Optional but Recommended)

By default, if you use your Personal Access Token (PAT) for the server, Yolo's comments will appear as if they were posted by **you**. To make comments appear professionally as a bot:

#### 🐙 For GitHub

**Option 1: GitHub App (⭐️ Best Practice)**
Using a GitHub App is the most secure and professional way. The comments will appear with the official `[bot]` badge (e.g., `yolo-reviewer[bot]`). It also scales automatically across all repos without needing a separate user account.

1. Go to your GitHub account/organization → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**.
2. Set the **GitHub App name** (e.g., `Yolo Reviewer`) and **Homepage URL** (e.g., your website).
3. Uncheck **Active** under the Webhook section (since we configure webhooks manually per-repo in this guide).
4. Under **Repository permissions**, set **Pull requests** to **Read and write**.
5. Click **Create GitHub App**.
6. On the next page, copy your **App ID** (at the top).
7. Scroll down to **Private keys** and click **Generate a private key**. A `.pem` file will be downloaded.
8. On the left sidebar, click **Install App** and install it on your selected repositories or the entire organization.
9. Instead of using `GITHUB_TOKEN` in your server's `.env`, provide these two variables:
   ```env
   GITHUB_APP_ID="your_app_id"
   GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...your key...\n-----END RSA PRIVATE KEY-----\n"
   ```
   *(Note: For the private key, replace actual line breaks with `\n` to fit on one line in the `.env` file).*

> 💡 **Troubleshooting Private Key Errors:**  
> If Yolo fails to start or throws a private key parsing error (e.g., in strict Docker environments), you might need to convert your `.pem` file to `pkcs8` format. Run this command in your terminal:  
> `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in downloaded_key.pem -out pkcs8_key.pem`  
> Then copy the contents of `pkcs8_key.pem` into your `.env`.

**Option 2: Personal Access Token (Bot Account)**
- Create a brand new GitHub account (e.g., `your-company-yolo-bot`).
- Invite this account to your repositories with *Write* access.
- Generate a PAT from this new account and put it in `.env` as `GITHUB_TOKEN`.
- *Note: In CI/CD Mode (GitHub Actions), you don't need any of this. The default `GITHUB_TOKEN` provided by the pipeline automatically posts as `github-actions[bot]`.*

#### 🦊 For GitLab

- **Group Access Token / Project Access Token (Recommended):** Go to Settings → Access Tokens at the Group or Project level. Create a token with `api` scope and name it `Yolo Reviewer`. GitLab automatically creates a background bot user with this name! Just put this token in `.env` as `GITLAB_TOKEN`.
- **Service Account:** Alternatively, ask your admin to create a dedicated Service Account.

---

<details>
<summary><strong>🖥️ Mode A: Server (Webhook)</strong></summary>

### Step 2A — Start the server

```bash
bun dev     # development, with hot-reload
bun start   # production
```

Server listens on `http://localhost:3000`.

### Step 3A — Expose to internet

For local development, use a tunnel:

```bash
ngrok http 3000
# or
cloudflared tunnel --url http://localhost:3000
```

For production, deploy to a VPS and point your domain to port 3000.

### Step 4A — Register webhook in GitLab

1. Go to your GitLab project → **Settings** → **Webhooks**.
2. Fill in:
   - **URL**: `https://your-server.com/webhook/gitlab`
   - **Secret token**: value of `GITLAB_WEBHOOK_SECRET` in your `.env`
3. Check **Merge request events** only. Click **Add webhook**.
4. **Test**: Click **Test** → **Merge request events** — a log should appear in your terminal.

### Step 4A (alt) — Register webhook in GitHub

1. Go to your repo → **Settings** → **Webhooks** → **Add webhook**.
2. Fill in:
   - **Payload URL**: `https://your-server.com/webhook/github`
   - **Content type**: `application/json`
   - **Secret**: value of `GITHUB_WEBHOOK_SECRET` in your `.env`
3. Select **Pull requests** only. Click **Add webhook**.
4. **Test**: Go to **Recent deliveries** tab → click any delivery → **Redeliver**.

</details>

---

<details>
<summary><strong>🐳 Mode B: Docker</strong></summary>

### Step 2B — Run with Docker Compose

```bash
# Clone this repo
git clone https://github.com/your-org/yolo-ai-reviewer
cd yolo-ai-reviewer

# Run the setup wizard
npx yolo-ai-reviewer init

# Build and start
docker compose up -d --build

# Check logs
docker compose logs -f yolo
```

`config.yml` is mounted as a read-only volume — edit it without rebuilding.

Then follow **Step 4A** to register webhooks.

</details>

---

<details>
<summary><strong>⚙️ Mode C: CI/CD (No Server)</strong></summary>

In CI/CD mode, the Yolo engine **runs directly inside your CI pipeline runner** — no server to deploy or maintain.

When a developer opens a PR/MR, the CI pipeline starts, downloads `yolo-ai-reviewer` via `npx`, reads credentials from repository secrets, runs the AI review, and posts comments — then exits.

### Step 2C — GitHub Actions

**a) Add secrets to your repository:**

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret | Value |
|---|---|
| `AI_BASE_URL` | e.g. `https://api.openai.com` |
| `AI_API_KEY` | your AI API key |
| `AI_MODEL` | e.g. `gpt-4o-mini` |

> `GITHUB_TOKEN` is provided automatically by GitHub Actions — no manual setup needed.

**b) Create the workflow file:**

```bash
mkdir -p .github/workflows
```

Create `.github/workflows/yolo-review.yml`:

```yaml
name: Yolo AI Review
on:
  pull_request:
    types: [opened, reopened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - name: Get PR Number
        id: pr
        run: echo "number=${{ github.event.pull_request.number }}" >> $GITHUB_OUTPUT
      - name: Run Yolo AI Review
        run: npx yolo-run
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          GITHUB_SHA: ${{ github.event.pull_request.head.sha }}
          GITHUB_BASE_REF: ${{ github.event.pull_request.base.ref }}
          PR_NUMBER: ${{ steps.pr.outputs.number }}
          AI_BASE_URL: ${{ secrets.AI_BASE_URL }}
          AI_API_KEY: ${{ secrets.AI_API_KEY }}
          AI_MODEL: ${{ secrets.AI_MODEL }}
```

### Step 2C — GitLab CI

**a) Add CI/CD variables:**

Go to your project → **Settings** → **CI/CD** → **Variables**:

| Variable | Value |
|---|---|
| `GITLAB_TOKEN` | a GitLab Personal Access Token with `api` scope |
| `GITLAB_URL` | `https://gitlab.com` or your self-hosted URL |
| `AI_BASE_URL` | your AI provider URL |
| `AI_API_KEY` | your AI API key |
| `AI_MODEL` | e.g. `gpt-4o-mini` |

**b) Add to your `.gitlab-ci.yml`:**

```yaml
yolo-review:
  stage: review
  image: node:20-alpine
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  script:
    - npx yolo-run
  variables:
    GITLAB_TOKEN: $GITLAB_TOKEN
    GITLAB_URL: $GITLAB_URL
    AI_BASE_URL: $AI_BASE_URL
    AI_API_KEY: $AI_API_KEY
    AI_MODEL: $AI_MODEL
```

</details>

---

## Teaching Yolo What to Review (`.skills/`)

Place a `.skills/` folder in each repository you want reviewed. Yolo fetches these files before every review and injects them into the AI prompt as your team's coding standards.

```
your-project/
└── .skills/
    ├── security.md
    ├── performance.md
    └── clean-code.md
```

Each file is plain markdown — write rules however you like. The **filename** (without `.md`) becomes the `category` that the AI assigns to violations.

**Example `security.md`:**

```markdown
- Never hardcode credentials, tokens, or API keys
- Always validate and sanitize user input
- Avoid exposing internal error details in API responses
```

If `.skills/` is missing, Yolo falls back to general best-practice review.

---

## Per-Repo Branch Filter (`.yolo/config.yml`)

Place a `.yolo/config.yml` in each repository to control which target branches trigger a review. Yolo fetches this file from the repo before starting.

```yaml
# .yolo/config.yml (commit this to your target repo)
filters:
  target_branches:
    - main
    - develop
```

If this file is missing, Yolo reviews all branches.

---

## Telegram Notifications

Get real-time alerts when the AI finds issues in specific categories.

### Setup

**1. Create a Telegram bot**

- Open Telegram → search **@BotFather** → `/newbot`
- Follow the steps → copy the **bot token**

**2. Get your chat ID**

- Start a chat with your bot (send it any message)
- Open in browser: `https://api.telegram.org/bot<TOKEN>/getUpdates`
- Find `"chat":{"id": 123456789}` — that number is your `chat_id`

**3. Configure `config.yml`**

```yaml
notifications:
  telegram:
    bot_token: "YOUR_BOT_TOKEN"
    chat_id: "YOUR_CHAT_ID"
    trigger_categories:
      - security   # alert when AI flags a security violation
      - critical   # alert for anything in .skills/critical.md
```

### How the AI knows the category

The AI assigns a `category` to each comment based on which `.skills/` rule was violated. A violation of a rule in `.skills/security.md` gets `category: "security"`. You decide which categories trigger a Telegram message via `trigger_categories`.

---

## Server Configuration Reference (`config.yml`)

```yaml
skillsPath: ".skills"
responseLanguage: "English"   # or "Indonesian"

features:
  autoResolve: true           # auto-resolve old comments when the issue is fixed
  summaryComment: true        # post a summary at the end of each review

behavior:
  diff_only: true             # only review changed lines
  no_hallucination: true      # instruct AI not to invent issues
  no_repeat_issue: true       # skip issues already commented
  avoid_nitpick: true         # skip stylistic nitpicks
  confidence_threshold: 0.7  # minimum AI confidence to post a comment

notifications:                # optional
  telegram:
    bot_token: "..."
    chat_id: "..."
    trigger_categories:
      - security
```

Changes to this file are picked up immediately while the server runs.

---

## License

MIT
