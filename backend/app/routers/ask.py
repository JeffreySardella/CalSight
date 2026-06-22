"""POST /api/ask — AI chat endpoint with function calling."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.ai_prompt import (
    SIMPLE_MODE_TEMPLATE,
    SYSTEM_PROMPT_TEMPLATE,
    TOOL_DEFINITIONS,
    build_filters_summary,
    build_quick_facts,
)
from app.ai_tools import TOOL_REGISTRY, query_crashes
from app.database import get_db
from app.llm_cache import get_ask_cache, make_cache_key
from app.models import ChatFeedback
from app.llm import (
    AllProvidersExhausted,
    generate_with_fallback,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ask"])

limiter = Limiter(key_func=get_remote_address)

_MAX_TOOL_ROUNDS = 3
_MAX_TOOL_CALLS_PER_ROUND = 3
_MAX_HISTORY = 10


class HistoryMessage(BaseModel):
    role: str
    content: str

    @field_validator("role")
    @classmethod
    def restrict_role(cls, v: str) -> str:
        if v not in ("user", "assistant"):
            raise ValueError("role must be 'user' or 'assistant'")
        return v

    @field_validator("content")
    @classmethod
    def cap_content_length(cls, v: str) -> str:
        if len(v) > 2000:
            return v[:2000]
        return v


class AskRequest(BaseModel):
    question: str
    filters: dict[str, str | None] = {}
    history: list[HistoryMessage] = []

    @field_validator("question")
    @classmethod
    def question_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Question cannot be empty")
        if len(v) > 500:
            raise ValueError("Question must be 500 characters or less")
        return v


class AskResponse(BaseModel):
    answer: str
    provider: str
    suggestions: list[str] = []
    chart: dict[str, Any] | None = None
    grounded: bool = False
    filters_used: dict[str, Any] = {}
    tools_called: list[str] = []


class FeedbackRequest(BaseModel):
    question: str
    answer: str
    provider: str = ""
    tools_called: list[str] = []
    vote: str
    filters_used: dict[str, Any] = {}

    @field_validator("vote")
    @classmethod
    def valid_vote(cls, v: str) -> str:
        if v not in ("up", "down"):
            raise ValueError("Vote must be 'up' or 'down'")
        return v


@router.post("/feedback")
@limiter.limit("30/minute")
def feedback(request: Request, body: FeedbackRequest, db: Session = Depends(get_db)):
    row = ChatFeedback(
        question=body.question,
        answer=body.answer[:2000],
        provider=body.provider,
        tools_called=json.dumps(body.tools_called),
        vote=body.vote,
        filters_used=json.dumps(body.filters_used, default=str),
    )
    db.add(row)
    db.commit()
    return {"ok": True}


@router.post("/ask", response_model=AskResponse)
@limiter.limit("10/minute;200/day")
async def ask(
    request: Request,
    response: Response,
    body: AskRequest,
    db: Session = Depends(get_db),
):
    # Cache lookup happens before the LLM round trip — identical
    # (question, filters, history) produce the same answer, and the LLM
    # call is the slow + expensive part. See app.llm_cache for the design.
    cache = get_ask_cache()
    history_payload = [m.model_dump() for m in body.history]
    cache_key = make_cache_key(body.question, body.filters, history_payload)
    cached = cache.get(cache_key)
    if cached is not None:
        response.headers["X-Cache"] = "HIT"
        return cached

    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_handle_ask, body, db),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        return JSONResponse(
            status_code=504,
            content={"message": "Request timed out. Please try again.", "retry_after": 5},
        )

    cache.set(cache_key, result)
    response.headers["X-Cache"] = "MISS"
    return result


def _handle_ask(body: AskRequest, db: Session) -> AskResponse:
    filters_summary = build_filters_summary(body.filters)
    # Quick Facts pre-queries the totals/severity-split for the active filters
    # and injects them into the system prompt. Saves a tool call for basic
    # count questions ("crashes in LA in 2023?") and gives the model a
    # grounded baseline before it decides whether to call tools.
    quick_facts = build_quick_facts(db, body.filters)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        active_filters=filters_summary,
        quick_facts=quick_facts,
    )

    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]

    for msg in body.history[-_MAX_HISTORY:]:
        messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": body.question})

    tools_called: list[str] = []

    try:
        answer, provider = _run_with_tools(db, messages, tools_called)
    except AllProvidersExhausted:
        answer, provider = _run_simple_mode(db, body.filters, messages)

    suggestions = _parse_suggestions(answer)
    chart = _parse_chart(answer)
    clean_answer = _strip_suggestions(_strip_chart(answer))

    return AskResponse(
        answer=clean_answer,
        provider=provider,
        suggestions=suggestions,
        chart=chart,
        grounded=len(tools_called) > 0,
        filters_used=body.filters,
        tools_called=tools_called,
    )


def _run_with_tools(
    db: Session,
    messages: list[dict],
    tools_called: list[str],
) -> tuple[str, str]:
    """Run the tool-calling loop (max 3 rounds).

    Round 0: tool_choice="required" — forces at least one tool call
    Round 1+: tool_choice="auto" — model can call more tools OR respond with text
    """
    provider = "unknown"
    for round_num in range(_MAX_TOOL_ROUNDS):
        tc = "required" if round_num == 0 else "auto"
        response, provider = generate_with_fallback(
            messages=messages,
            tools=TOOL_DEFINITIONS,
            tool_choice=tc,
            max_tokens=1200,
        )
        choice = response.choices[0]
        has_tools = bool(choice.message.tool_calls)
        logger.info("Round %d: provider=%s tool_choice=%s has_tool_calls=%s", round_num, provider, tc, has_tools)

        if not choice.message.tool_calls and round_num == 0:
            logger.warning("Round 0: no tool call despite required. Nudging model.")
            messages.append({"role": "assistant", "content": choice.message.content or ""})
            messages.append({"role": "user", "content": "Please use one of your available tools to query the CalSight database and answer with real data."})
            continue

        if choice.message.tool_calls:
            capped_calls = choice.message.tool_calls[:_MAX_TOOL_CALLS_PER_ROUND]
            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": choice.message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in capped_calls
                ],
            }
            messages.append(assistant_msg)
            for tool_call in capped_calls:
                fn_name = tool_call.function.name
                tools_called.append(fn_name)
                try:
                    args = json.loads(tool_call.function.arguments)
                    fn = TOOL_REGISTRY.get(fn_name)
                    if fn:
                        result = fn(db, **args)
                    else:
                        result = {"error": f"Unknown tool: {fn_name}"}
                except Exception as e:
                    logger.warning("Tool %s failed: %s", fn_name, e)
                    result = {"error": "Tool execution failed. Please try again or rephrase your question."}

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result, default=str),
                })
        else:
            return choice.message.content or "", provider

    # Final round called tools — send one more LLM call to process results
    if messages and messages[-1].get("role") == "tool":
        response, provider = generate_with_fallback(
            messages=messages,
            tools=TOOL_DEFINITIONS,
            tool_choice="none",
            max_tokens=1200,
        )
        return response.choices[0].message.content or "", provider

    return response.choices[0].message.content or "", provider


def _run_simple_mode(
    db: Session,
    filters: dict,
    messages: list[dict],
) -> tuple[str, str]:
    """Fallback for providers without tool use."""
    years_raw = filters.get("year") or ""
    years = [int(y) for y in years_raw.split(",") if y.strip().isdigit()] or None
    stats = query_crashes(db, county=filters.get("county"), years=years)
    stats_text = json.dumps(stats, default=str)
    filters_summary = build_filters_summary(filters)

    messages[0] = {
        "role": "system",
        "content": SIMPLE_MODE_TEMPLATE.format(
            active_filters=filters_summary,
            stats_context=stats_text,
        ),
    }

    response, provider = generate_with_fallback(
        messages=messages,
        tools=None,
        max_tokens=500,
    )
    return response.choices[0].message.content or "", provider


def _parse_suggestions(text: str) -> list[str]:
    match = re.search(r'\*{0,2}Suggested:?\*{0,2}\s*\[(.+?)\]', text, re.DOTALL)
    if not match:
        return []
    try:
        return json.loads(f"[{match.group(1)}]")
    except (json.JSONDecodeError, ValueError):
        return []


def _strip_suggestions(text: str) -> str:
    return re.sub(r'\n*-{0,3}\n*\*{0,2}Suggested:?\*{0,2}\s*\[.+?\]', '', text, flags=re.DOTALL).strip()


def _parse_chart(text: str) -> dict[str, Any] | None:
    match = re.search(r'\*{0,2}Chart:?\*{0,2}\s*(\{.*"data"\s*:\s*\[.*\].*\})', text, re.DOTALL)
    if not match:
        return None
    raw = match.group(1)
    # Find the balanced JSON by trying progressively larger substrings
    for end in range(len(raw), 0, -1):
        candidate = raw[:end]
        if candidate.count("{") != candidate.count("}"):
            continue
        try:
            chart = json.loads(candidate)
            if isinstance(chart, dict) and "data" in chart and "type" in chart:
                return chart
        except (json.JSONDecodeError, ValueError):
            continue
    return None


def _strip_chart(text: str) -> str:
    # Strip complete chart blocks
    text = re.sub(r'\n*-{0,3}\n*\*{0,2}Chart:?\*{0,2}\s*\{.*"data"\s*:\s*\[.*\].*\}', '', text, flags=re.DOTALL).strip()
    # Strip truncated/partial chart blocks (LLM hit token limit mid-JSON)
    text = re.sub(r'\n*-{0,3}\n*\*{0,2}Chart:?\*{0,2}\s*\{.*$', '', text, flags=re.DOTALL).strip()
    return text
