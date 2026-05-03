"""POST /api/ask — AI chat endpoint with function calling."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.ai_prompt import (
    SIMPLE_MODE_TEMPLATE,
    SYSTEM_PROMPT_TEMPLATE,
    TOOL_DEFINITIONS,
    build_filters_summary,
)
from app.ai_tools import TOOL_REGISTRY, query_crashes
from app.database import get_db
from app.llm import (
    AllProvidersExhausted,
    SUPPORTS_TOOL_USE,
    generate_with_fallback,
    _get_provider_chain,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ask"])

limiter = Limiter(key_func=get_remote_address)

_MAX_TOOL_ROUNDS = 3
_MAX_HISTORY = 10


class HistoryMessage(BaseModel):
    role: str
    content: str


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
    filters_used: dict[str, Any] = {}
    tools_called: list[str] = []


@router.post("/ask", response_model=AskResponse)
@limiter.limit("10/minute")
def ask(request: Request, body: AskRequest, db: Session = Depends(get_db)):
    filters_summary = build_filters_summary(body.filters)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(active_filters=filters_summary)

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
    clean_answer = _strip_suggestions(answer)

    return AskResponse(
        answer=clean_answer,
        provider=provider,
        suggestions=suggestions,
        filters_used=body.filters,
        tools_called=tools_called,
    )


def _run_with_tools(
    db: Session,
    messages: list[dict],
    tools_called: list[str],
) -> tuple[str, str]:
    """Run the tool-calling loop (max 3 rounds)."""
    provider = "unknown"
    for round_num in range(_MAX_TOOL_ROUNDS):
        response, provider = generate_with_fallback(
            messages=messages,
            tools=TOOL_DEFINITIONS,
            tool_choice="required" if round_num == 0 else "none",
            max_tokens=500,
        )
        choice = response.choices[0]

        if choice.message.tool_calls:
            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": choice.message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in choice.message.tool_calls
                ],
            }
            messages.append(assistant_msg)
            for tool_call in choice.message.tool_calls:
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
                    result = {"error": str(e)}

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result, default=str),
                })
        else:
            return choice.message.content or "", provider

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
