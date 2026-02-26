# ORACLE — AI HR Outreach Intelligence System

A full-stack, AI-driven web application that automates and hyper-personalizes job search and networking outreach using a multi-agent CrewAI pipeline.

---

## Architecture

```
├── app/
│   ├── layout.tsx          # Next.js root layout + fonts
│   ├── page.tsx            # Main UI (input + streaming results)
│   └── globals.css         # Design system & animations
├── api/
│   └── index.py            # FastAPI backend + CrewAI agents (Vercel serverless)
├── next.config.ts          # Proxies /api/* → FastAPI in dev
├── vercel.json             # Vercel deployment config
├── requirements.txt        # Python dependencies
└── package.json            # Node dependencies
```

## Agent Pipeline

| # | Agent | Key | Task |
|---|-------|-----|------|
| 1 | **Profile Summarizer** | `profile_summary` | Visits LinkedIn URL, extracts professional background, career, interests |
| 2 | **Deep Researcher** | `deep_research` | Investigates company culture, news, hiring signals, strategic priorities |
| 3 | **Fitness Evaluator** | `fitness_eval` | Cross-references resume against research, produces fit score |
| 4 | **Strategic Planner** | `strategy` | Generates approach strategy + a personalized, ready-to-send outreach message |

Results stream to the UI via **Server-Sent Events (SSE)** as each agent completes.

---

## Local Development

### 1. Clone & install

```bash
git clone <repo>
cd hr-outreach

npm install
pip install -r requirements.txt
```

### 2. Environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | ✅ | Powers all CrewAI agents |
| `SERPER_API_KEY` | Optional | Enables web search for agents (recommended) |
| `APIFY_API_TOKEN` | Optional | For LinkedIn scraping via Apify |

### 3. Run both servers

**Terminal 1 — FastAPI backend:**
```bash
uvicorn api.index:app --reload --port 8000
```

**Terminal 2 — Next.js frontend:**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployment on Vercel

```bash
npm install -g vercel
vercel deploy
```

Add your environment variables in the Vercel dashboard under **Project → Settings → Environment Variables**.

The `vercel.json` routes `/api/*` to the Python serverless function automatically.

---

## Usage

1. Paste a LinkedIn profile URL for the target HR manager
2. (Optional) Paste or upload your resume as `.txt` or `.md`
3. Click **Launch Intelligence Sweep**
4. Watch all four agents run in real time and display their outputs
5. Switch to **Raw** view to copy the full intelligence brief

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.11 |
| AI Agents | CrewAI, LangChain, GPT-4o-mini |
| Search Tools | Serper (web search), WebsiteSearchTool |
| Deployment | Vercel (Next.js + Python serverless) |
| Streaming | Server-Sent Events (SSE) |

---

## Notes

- **LinkedIn scraping**: Direct LinkedIn scraping is restricted. For production, integrate [Apify's LinkedIn scraper](https://apify.com/dev_fusion/linkedin-profile-scraper) or similar.
- **Agent timeouts**: Vercel serverless functions have a 60s timeout (configured in `vercel.json`). For complex profiles, consider running the backend on a persistent server.
- **Cost**: Each full pipeline run uses ~4 LLM calls. With GPT-4o-mini, cost is typically < $0.05 per run.
