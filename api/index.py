"""
ORACLE — AI HR Outreach Intelligence System
FastAPI backend — streams tokens live as each agent generates them.

SSE event types:
  {"agent": "...", "status": "running"}              — agent started
  {"agent": "...", "status": "token", "token": "…"}  — live token
  {"agent": "...", "status": "done",  "output": "…"} — agent finished
  {"agent": "...", "status": "error", "error": "…"}  — agent failed
"""

import base64
import json
import os
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="ORACLE API", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Models ───────────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    linkedin_pdf: str
    resume: str = ""
    resume_pdf: str = ""

# ─── PDF extraction ───────────────────────────────────────────────────────────

def extract_pdf_text(pdf_base64: str) -> str:
    try:
        from pypdf import PdfReader
        import io
        pdf_bytes = base64.b64decode(pdf_base64)
        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = "\n\n".join(p.extract_text() or "" for p in reader.pages).strip()
        if not text:
            raise ValueError("PDF is empty or image-only (scanned PDF not supported).")
        return text
    except ImportError:
        raise RuntimeError("pypdf not installed. Run: pip install pypdf")

# ─── OpenAI client ────────────────────────────────────────────────────────────

def get_client() -> AsyncOpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    return AsyncOpenAI(
        api_key=api_key,
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    )

MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# ─── Streaming LLM call ───────────────────────────────────────────────────────

async def llm_stream(
    client: AsyncOpenAI,
    agent_key: str,
    system: str,
    user: str,
) -> AsyncGenerator[str, None]:
    """Streams tokens as SSE events and finally yields a 'done' event."""
    full_text = []

    def sse(event: dict) -> str:
        return f"data: {json.dumps(event)}\n\n"

    try:
        stream = await client.chat.completions.create(
            model=MODEL,
            temperature=0.3,
            stream=True,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
        )
        async for chunk in stream:
            token = chunk.choices[0].delta.content
            if token:
                full_text.append(token)
                yield sse({"agent": agent_key, "status": "token", "token": token})

        yield sse({"agent": agent_key, "status": "done", "output": "".join(full_text)})

    except Exception as e:
        yield sse({"agent": agent_key, "status": "error", "error": str(e)})

# ─── Agent system prompts ─────────────────────────────────────────────────────

SYS_SUMMARIZER = """
You are an expert talent intelligence analyst specialising in reading LinkedIn profiles.
Your job: analyse the HR manager's LinkedIn profile text and extract structured intelligence.

CONTEXT: A job candidate wants to reach out to this HR manager. Your summary will be used
by downstream agents to research the company and craft a personalised outreach strategy.

RULES:
- Use markdown: ## for section headers, **bold** for names/titles/companies, - for bullets
- Be concise: 3-5 bullets per section, no waffle
- Focus on signals that would help a candidate connect with this person personally"""

SYS_RESEARCHER = """
You are a corporate intelligence researcher. Your job: build a deep intelligence brief
on the HR manager's company so a job candidate can reference specific, accurate details
in their outreach message, making it feel informed and non-generic.

RULES:
- Use markdown: ## for sections, **bold** for key facts, - for bullets
- 4-6 bullets per section, specific and factual
- If you lack live data, reason clearly from the profile context and known industry patterns
- Flag anything a candidate could use as a natural conversation hook"""

SYS_EVALUATOR = """
You are a career strategist and resume fitness evaluator. Your job: cross-reference
the CANDIDATE'S resume against the HR manager's company and role needs.

IMPORTANT DIRECTION: The CANDIDATE is reaching out TO the HR manager, not the other way around.
Evaluate the candidate's fit from the candidate's perspective.

RULES:
- Use markdown: ## for sections, **bold** for key points
- Be honest and specific: flag real gaps, don't just be positive
- End with ## Fit Score: X/10 and a one-sentence justification"""

SYS_STRATEGIST = """
You are a master job-search outreach strategist. Your job: write a strategy and a
ready-to-send message FROM the candidate TO the HR manager.

CRITICAL DIRECTION - never mix this up:
- SENDER   = the JOB CANDIDATE (whose resume you have)
- RECEIVER = the HR MANAGER (whose LinkedIn profile was analysed)
- The message must be written in FIRST PERSON as the CANDIDATE, addressed to the HR MANAGER by name

RULES:
- Use ## APPROACH STRATEGY and ## OUTREACH MESSAGE as section headers
- Strategy: 4 bullets (channel, timing, conversation hook, what to avoid)
- Message: under 150 words, written AS the candidate TO the HR manager
- Do NOT use placeholder names like [Your Name] — sign off with "Best regards," only
- Reference specific real details from the candidate's background AND the company research
- Lead with value the candidate offers, not a generic compliment
- End with a single low-friction call to action (e.g. "Would a 15-minute call this week work?")"""

# ─── Pipeline ─────────────────────────────────────────────────────────────────

AGENT_KEYS = ["profile_summary", "deep_research", "fitness_eval", "strategy"]

def sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"

async def run_pipeline(
    linkedin_pdf: str,
    resume: str,
    resume_pdf: str = "",
) -> AsyncGenerator[str, None]:

    # Extract PDFs
    try:
        linkedin_text = extract_pdf_text(linkedin_pdf)
    except Exception as e:
        for k in AGENT_KEYS:
            yield sse({"agent": k, "status": "error", "error": f"LinkedIn PDF: {e}"})
        yield "data: [DONE]\n\n"
        return

    if resume_pdf:
        try:
            resume = extract_pdf_text(resume_pdf)
        except Exception as e:
            for k in AGENT_KEYS:
                yield sse({"agent": k, "status": "error", "error": f"Resume PDF: {e}"})
            yield "data: [DONE]\n\n"
            return

    try:
        client = get_client()
    except Exception as e:
        for k in AGENT_KEYS:
            yield sse({"agent": k, "status": "error", "error": str(e)})
        yield "data: [DONE]\n\n"
        return

    resume_block = f"CANDIDATE RESUME:\n{resume}" if resume.strip() \
        else "No resume provided — evaluate generally."

    # ── Agent 1: Profile Summarizer ───────────────────────────────────────────
    yield sse({"agent": "profile_summary", "status": "running"})
    profile_summary = []
    async for chunk in llm_stream(client, "profile_summary", SYS_SUMMARIZER, f"""
Analyse this LinkedIn profile PDF text and extract a structured summary.

LINKEDIN PROFILE TEXT:
{linkedin_text}

Cover: name & title, career history (key milestones only), core skills,
education, personality signals, what they value in candidates.
"""):
        if '"status": "token"' in chunk:
            token = json.loads(chunk[6:])["token"]
            profile_summary.append(token)
        yield chunk
    profile_summary_text = "".join(profile_summary)

    # ── Agent 2: Deep Research ────────────────────────────────────────────────
    yield sse({"agent": "deep_research", "status": "running"})
    deep_research = []
    async for chunk in llm_stream(client, "deep_research", SYS_RESEARCHER, f"""
Research this HR manager's company based on their profile.

HR MANAGER PROFILE:
{profile_summary_text}

Cover: company overview, recent news, culture signals, current hiring trends,
strategic priorities, one unique angle a candidate could use in outreach.
If live data unavailable, reason from context and industry knowledge.
"""):
        if '"status": "token"' in chunk:
            token = json.loads(chunk[6:])["token"]
            deep_research.append(token)
        yield chunk
    deep_research_text = "".join(deep_research)

    # ── Agent 3: Fitness Evaluation ───────────────────────────────────────────
    yield sse({"agent": "fitness_eval", "status": "running"})
    fitness_eval = []
    async for chunk in llm_stream(client, "fitness_eval", SYS_EVALUATOR, f"""
{resume_block}

HR MANAGER PROFILE:
{profile_summary_text}

COMPANY RESEARCH:
{deep_research_text}

Evaluate: skills alignment, experience relevance, culture fit, gaps,
unique value proposition, fit score 1-10 with justification.
"""):
        if '"status": "token"' in chunk:
            token = json.loads(chunk[6:])["token"]
            fitness_eval.append(token)
        yield chunk
    fitness_eval_text = "".join(fitness_eval)

    # ── Agent 4: Strategic Planner ────────────────────────────────────────────
    yield sse({"agent": "strategy", "status": "running"})
    async for chunk in llm_stream(client, "strategy", SYS_STRATEGIST, f"""
You are helping THE CANDIDATE write a message TO the HR manager.
THE CANDIDATE is the sender. THE HR MANAGER is the recipient.

--- CANDIDATE'S BACKGROUND (the SENDER) ---
{resume_block}

--- HR MANAGER PROFILE (the RECIPIENT) ---
{profile_summary_text}

--- COMPANY RESEARCH ---
{deep_research_text}

--- FITNESS EVALUATION ---
{fitness_eval_text}

Now produce:
1. ## APPROACH STRATEGY — 4 bullets on how the candidate should approach outreach
2. ## OUTREACH MESSAGE — a complete message written in first person AS the candidate,
   addressed to the HR manager by their first name. Under 150 words. No placeholder text.
"""):
        yield chunk

    yield "data: [DONE]\n\n"

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "model": MODEL}

@app.post("/api/run")
async def run_outreach(req: RunRequest):
    if not req.linkedin_pdf:
        raise HTTPException(400, "linkedin_pdf is required.")
    return StreamingResponse(
        run_pipeline(req.linkedin_pdf, req.resume, req.resume_pdf),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )