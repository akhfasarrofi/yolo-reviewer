# Yolo AI Reviewer

**Automated AI code review for GitLab Merge Requests.**

Yolo listens to GitLab webhooks, analyzes changed code using an AI model, and posts inline comments directly on the MR diff — no plugins, no CI changes required.

---

## How It Works

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant GL as GitLab
    participant Yolo as Yolo Server
    participant AI as AI Model

    Dev->>GL: Open / Update MR
    GL->>Yolo: Webhook (MR event)
    Yolo->>GL: Fetch changed file diffs
    Yolo->>GL: Fetch .skills/*.md from target repo
    Yolo->>AI: Send code + skill rules + instruction
    AI->>Yolo: JSON response (line, issue, suggestion)
    Yolo->>GL: Post inline comment on MR diff
```

---

## Requirements

- [Bun](https://bun.sh) v1.0+
- GitLab instance (self-hosted or gitlab.com)
- An OpenAI-compatible AI proxy (`/v1/chat/completions` endpoint)

---

## Setup

### 1. Environment Variables

Create a `.env` file at the root:

```env
# GitLab
GITLAB_URL=https://gitlab.yourcompany.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
GITLAB_WEBHOOK_SECRET=your-webhook-secret

# AI (OpenAI-compatible proxy)
AI_BASE_URL=https://your-ai-proxy.com
AI_API_KEY=your-api-key
AI_MODEL=gemini-2-flash
```

### 2. Run

```bash
bun install
bun run dev
```

Server starts on `http://localhost:4000`.

### 3. Register Webhook in GitLab

Go to your GitLab project → **Settings → Webhooks**, then add:

| Field | Value |
|---|---|
| URL | `http://your-server:4000/webhook/gitlab` |
| Secret token | Value of `GITLAB_WEBHOOK_SECRET` |
| Trigger | ✅ Merge request events |

---

## Adding Skill Rules to Your Repo

Yolo fetches review guidelines directly from the repository being reviewed. Create a `.skills/` folder at the root of your project:

```
your-project/
└── .skills/
    ├── security.md
    ├── performance.md
    └── clean-code.md
```

Each `.md` file contains plain-text rules in any format you prefer. All files in `.skills/` are merged and sent to the AI as review standards.

> If `.skills/` does not exist in the target repo, Yolo will silently skip that repo.

**Example `security.md`:**

```markdown
- Never hardcode credentials, tokens, or API keys
- Always validate and sanitize user input before processing
- Avoid exposing internal error details in API responses
```

---

## Configuration

All configuration lives in `config.json` at the root of this repo.

```jsonc
{
  // Folder name Yolo looks for in every target repo
  // All repos must use the same folder name
  "skillsPath": ".skills",

  // Paths to always skip when scanning diffs
  "exclude": ["node_modules", "dist", "vendor", ...],

  // File extension → language mapping
  // Add a new entry here to support a new language
  // No restart required — config is hot-reloaded on save
  "extensions": {
    ".ts": "typescript",
    ".go": "go",
    ".py": "python"
    // ...
  },

  // AI persona and review instruction
  // Use {{language}} and {{skillRules}} as placeholders
  //
  // ⚠️  Do NOT modify the ## OUTPUT FORMAT section or its JSON structure.
  //     Changing it will break Yolo's ability to parse AI responses
  //     and no comments will be posted.
  "instruction": [...]
}
```

### Adding a New Language

Add the file extension to `config.extensions`:

```json
".cs": "csharp",
".dart": "dart"
```

Changes to `config.json` are picked up immediately — no restart needed.

---

## License

MIT
