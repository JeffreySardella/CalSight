"""POST /api/ask — AI chat endpoint with function calling.

``POST /api/ask/stream`` is the same pipeline with the final LLM call streamed
back as Server-Sent Events. Both share the prompt builder, guardrails, tool
loop and answer post-processing below; only the transport differs.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, field_validator
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy.orm import Session

from app.ai_prompt import (
    _ALLOWED_COUNTIES,
    SIMPLE_MODE_TEMPLATE,
    SYSTEM_PROMPT_TEMPLATE,
    TOOL_DEFINITIONS,
    build_filters_summary,
    build_quick_facts,
)
from app.ai_tools import TOOL_REGISTRY, query_crashes
from app.database import SessionLocal, apply_statement_timeout, get_db
from app.grounding import answer_cites_tool_numbers, trend_word_contradictions
from app.llm_cache import get_ask_cache, make_cache_key
from app.models import ChatFeedback
from app.llm import (
    AllProvidersExhausted,
    consume_stream,
    generate_with_fallback,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ask"])

limiter = Limiter(key_func=rate_limit_key)

# ONE bucket for every way of asking a question. slowapi scopes a plain
# @limiter.limit to the endpoint, so giving /ask/stream its own decorator would
# hand each caller a second 10/minute;200/day allowance of LLM calls — and the
# client falls back from a throttled stream to /api/ask, which would then serve
# it from that second bucket. shared_limit(scope="ask") keeps them on one.
_ask_limit = limiter.shared_limit("10/minute;200/day", scope="ask")

_MAX_TOOL_ROUNDS = 3
_MAX_TOOL_CALLS_PER_ROUND = 3
_MAX_HISTORY = 10
_ASK_TIMEOUT_SECONDS = 60.0
# Per-query backstop for the AI-tool path. Below the 60s request deadline so a
# runaway 11M-row aggregation is killed by Postgres and releases its pool
# connection instead of outliving the (already-504'd) request.
_STATEMENT_TIMEOUT_MS = 50_000


def _apply_statement_timeout(db: Session, ms: int = _STATEMENT_TIMEOUT_MS) -> None:
    apply_statement_timeout(db, ms)


class _AskAbandoned(Exception):
    """The HTTP request already timed out; stop burning LLM quota."""


# Yielded by the streaming tool loop when a round it already streamed turns
# out to be a tool call: the prose was the model narrating ("Let me check the
# data…"), it is discarded server-side, and the client must drop it too.
_RESET = object()


class _Status:
    """A progress line for the reader ("Looking up ... in Los Angeles").

    The tool rounds before the first answer token take 10-20 s on a long
    question, and without these the stream sent nothing at all until then:
    a phone showed a typing indicator for 25 s (audit 2026-09-22).
    """

    def __init__(self, text: str):
        self.text = text


# What each tool is doing, in words a visitor reads while waiting.
_TOOL_STATUS = {
    "query_crashes": "Querying crash records",
    "rank_counties": "Ranking counties",
    "compare_counties": "Comparing counties",
    "get_trend": "Pulling the year-by-year trend",
    "get_demographics": "Looking up Census demographics",
    "get_weather": "Looking up weather",
    "get_road_info": "Looking up roads",
    "get_environmental": "Looking up CalEnviroScreen scores",
    "get_party_demographics": "Looking up the drivers involved",
    "get_victim_info": "Looking up injuries",
    "get_unemployment": "Looking up unemployment",
    "get_vehicle_stats": "Looking up registered vehicles",
    "get_crash_rate": "Working out crash rates",
    "get_top_intersections": "Finding the worst intersections",
    "get_street_concentration": "Measuring street concentration",
    "get_yoy_changes": "Comparing year over year",
    "get_mode_breakdown": "Counting people hurt or killed by travel mode",
    "get_vmt": "Looking up miles driven",
    "get_school_crashes": "Looking up crashes near schools",
    "get_tract_burden": "Looking up neighborhood burden",
    "first_rain": "Looking up the first storm",
}


def _tool_status(fn_name: str, arguments: str) -> _Status:
    text = _TOOL_STATUS.get(fn_name, "Querying the CalSight database")
    try:
        county = json.loads(arguments).get("county")
    except (ValueError, AttributeError):
        county = None
    # The county is model output: only a real county name reaches the reader.
    if isinstance(county, str) and county.replace("-", " ").lower() in _ALLOWED_COUNTIES:
        text += f" in {county.replace('-', ' ').title()}"
    return _Status(text + "...")


# Control characters have no legitimate use in chat text but do show up in
# terminal-escape / token-smuggling injection tricks. Strip everything in C0
# except newline (\x0a) and tab (\x09), plus DEL and the C1 range (#293).
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")


def _strip_control_chars(v: str) -> str:
    return _CONTROL_CHARS_RE.sub("", v)


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
        # History content goes verbatim into the LLM message list — sanitize
        # it, not just the role field (#293).
        v = _strip_control_chars(v)
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
        v = _strip_control_chars(v).strip()
        if not v:
            raise ValueError("Question cannot be empty")
        if len(v) > 500:
            raise ValueError("Question must be 500 characters or less")
        return v

    @field_validator("history")
    @classmethod
    def cap_history_length(cls, v: list) -> list:
        # Only the last 10 messages reach the LLM, but the full list is
        # parsed and hashed into the cache key — an unbounded history is a
        # request-amplification vector (audit 2026-07-09 L2).
        return v[-20:]

    @field_validator("filters")
    @classmethod
    def cap_filters(cls, v: dict) -> dict:
        if len(v) > 30:
            raise ValueError("Too many filters")
        return {k[:50]: (val[:200] if val else val) for k, val in v.items()}


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

    @field_validator("question")
    @classmethod
    def cap_question(cls, v: str) -> str:
        # Written verbatim to chat_feedback via the API role's INSERT grant;
        # uncapped fields allow arbitrary-size rows (audit 2026-07-09 L2).
        return v[:1000]

    @field_validator("provider")
    @classmethod
    def cap_provider(cls, v: str) -> str:
        return v[:100]

    @field_validator("tools_called")
    @classmethod
    def cap_tools_called(cls, v: list[str]) -> list[str]:
        return [t[:100] for t in v[:20]]

    @field_validator("filters_used")
    @classmethod
    def cap_filters_used(cls, v: dict) -> dict:
        if len(v) > 30:
            raise ValueError("Too many filters")
        return v

    @field_validator("vote")
    @classmethod
    def valid_vote(cls, v: str) -> str:
        if v not in ("up", "down"):
            raise ValueError("Vote must be 'up' or 'down'")
        return v


class FeedbackResponse(BaseModel):
    ok: bool


@router.post("/feedback", response_model=FeedbackResponse)
@limiter.limit("30/minute")
def feedback(
    request: Request,
    response: Response,
    body: FeedbackRequest,
    db: Session = Depends(get_db),
):
    # Explicitly uncacheable — a write endpoint (#291).
    response.headers["Cache-Control"] = "no-store"
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
    return FeedbackResponse(ok=True)


@router.post("/ask", response_model=AskResponse)
@_ask_limit
async def ask(
    request: Request,
    response: Response,
    body: AskRequest,
):
    # Explicitly uncacheable at the HTTP layer (#291): answers depend on the
    # POST body, so shared caches must never store them. The server-side
    # answer cache below (X-Cache) is separate and unaffected.
    response.headers["Cache-Control"] = "no-store"
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

    # _handle_ask runs on a worker thread that can outlive this request
    # (wait_for gives up, the thread keeps going). The thread owns its DB
    # session — borrowing the request-scoped one would let FastAPI's
    # teardown close it mid-query on timeout and hand the underlying
    # connection back to the pool while the thread is still using it.
    try:
        handled = await asyncio.wait_for(
            asyncio.to_thread(_handle_ask, body),
            timeout=_ASK_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        handled = None
    if handled is None:
        return JSONResponse(
            status_code=504,
            content={"message": "Request timed out. Please try again.", "retry_after": 5},
        )

    result, cacheable = handled
    # Degraded answers (simple-mode fallback after provider exhaustion, or a
    # run where no tool executed successfully) must not be served from cache
    # for the next hour — the very next attempt would likely succeed (L6).
    if cacheable:
        cache.set(cache_key, result)
    response.headers["X-Cache"] = "MISS"
    return result


def _sse(event: str, data: dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n".encode()


def _sse_tokens(tokens: Iterator[Any], deadline: float) -> Iterator[bytes]:
    """Re-frame a token generator as SSE, passing its return value through.

    The deadline is re-checked per token, not just per tool round: the OpenAI
    client's ``timeout`` is per read, so a provider trickling one token every
    29s would otherwise hold this connection (and its DB session) open long
    past the deadline ``/api/ask`` enforces with ``asyncio.wait_for``.
    """
    try:
        while True:
            if time.monotonic() >= deadline:
                raise _AskAbandoned()
            item = next(tokens)
            if item is _RESET:
                yield _sse("reset", {})
            elif isinstance(item, _Status):
                yield _sse("status", {"text": item.text})
            else:
                yield _sse("token", {"t": item})
    except StopIteration as stop:
        return stop.value


def _stream_ask(body: AskRequest) -> Iterator[bytes]:
    """SSE body: `token` events while the answer is generated, then `done`.

    Runs on Starlette's threadpool (a sync generator), so it owns its own DB
    session for the same reason ``_handle_ask`` does.
    """
    db = None
    try:
        # Inside the try: the response has already started by the time this
        # generator runs, so an exception here must become an `error` event
        # rather than tearing down the connection with no terminal event.
        cache = get_ask_cache()
        history_payload = [m.model_dump() for m in body.history]
        cache_key = make_cache_key(body.question, body.filters, history_payload)
        cached = cache.get(cache_key)
        if cached is not None:
            yield _sse("token", {"t": cached.answer})
            yield _sse("done", {**cached.model_dump(), "cached": True})
            return

        deadline = time.monotonic() + _ASK_TIMEOUT_SECONDS
        # First byte now, not after the first tool round: it also gets the
        # response headers through every proxy straight away.
        yield _sse("status", {"text": "Choosing what to look up..."})
        db = SessionLocal()
        _apply_statement_timeout(db)
        messages = _build_messages(body, db)
        tools_called: list[str] = []
        tools_succeeded: list[str] = []
        tool_results: list[str] = []
        degraded = False
        try:
            answer, provider = yield from _sse_tokens(
                _run_with_tools_gen(
                    db, messages, tools_called, tools_succeeded, deadline, tool_results,
                    stream=True,
                ),
                deadline,
            )
        except AllProvidersExhausted:
            try:
                answer, provider = _run_simple_mode(db, body.filters, messages)
            except Exception:
                logger.exception("Simple-mode fallback failed after provider exhaustion")
                yield _sse("done", {
                    **_providers_exhausted_response(body, tools_called).model_dump(),
                    "cached": False,
                })
                return
            degraded = True
            # Simple mode is a plain non-streamed call; deliver it in one go.
            yield _sse("token", {"t": answer})

        result, cacheable = _finalize_answer(
            body, answer, provider, tools_called, tools_succeeded, tool_results, degraded
        )
        if cacheable:
            cache.set(cache_key, result)
        yield _sse("done", {**result.model_dump(), "cached": False})
    except _AskAbandoned:
        logger.warning("Ask stream abandoned after timeout; stopped tool loop early")
        yield _sse("error", {"message": "Request timed out. Please try again."})
    except Exception:
        # Mid-stream provider failure lands here: the client already has
        # partial text, so there is nobody left to fail over to.
        logger.exception("Ask stream failed")
        yield _sse("error", {"message": "The AI stream was interrupted. Please try again."})
    finally:
        if db is not None:
            db.close()


@router.post("/ask/stream")
@_ask_limit
async def ask_stream(request: Request, body: AskRequest):
    """Same answer as POST /api/ask, delivered token by token over SSE.

    POST, not GET, on purpose: a Cloudflare cache rule stores API GETs for
    about an hour, which would serve one user's answer stream to the next.
    ``Cache-Control: no-store`` matches /api/ask — answers depend on the POST
    body, so no shared cache may store them (#291). ``X-Accel-Buffering: no``
    disables proxy buffering where a reverse proxy honours it; Starlette's
    GZipMiddleware excludes text/event-stream, which
    ``test_sse_is_not_gzipped`` pins so an upgrade cannot silently regress it.
    """
    return StreamingResponse(
        _stream_ask(body),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _handle_ask(body: AskRequest) -> tuple[AskResponse, bool] | None:
    """Returns (response, cacheable) or None if the request was abandoned."""
    deadline = time.monotonic() + _ASK_TIMEOUT_SECONDS
    db = SessionLocal()
    try:
        _apply_statement_timeout(db)
        return _handle_ask_inner(body, db, deadline)
    except _AskAbandoned:
        logger.warning("Ask request abandoned after timeout; stopped tool loop early")
        return None
    finally:
        db.close()


def _build_messages(body: AskRequest, db: Session) -> list[dict[str, Any]]:
    """System prompt (with Quick Facts) + capped history + the question.

    Shared by the JSON and SSE endpoints — the streaming path must not drift
    from the prompt the non-streaming one sends.
    """
    filters_summary = build_filters_summary(body.filters)
    # Quick Facts pre-queries the totals/severity-split for the active filters
    # and injects them into the system prompt. Saves a tool call for basic
    # count questions ("crashes in LA in 2023?") and gives the model a
    # grounded baseline before it decides whether to call tools.
    quick_facts = build_quick_facts(db, body.filters, statement_timeout_ms=_STATEMENT_TIMEOUT_MS)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        active_filters=filters_summary,
        quick_facts=quick_facts,
    )

    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]

    for msg in body.history[-_MAX_HISTORY:]:
        messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": body.question})
    return messages


def _providers_exhausted_response(body: AskRequest, tools_called: list[str]) -> AskResponse:
    return AskResponse(
        answer=(
            "AI is temporarily unavailable — all providers are busy or "
            "rate limited right now. Please try again in a few minutes."
        ),
        provider="none",
        grounded=False,
        filters_used=body.filters,
        tools_called=tools_called,
    )


def _handle_ask_inner(body: AskRequest, db: Session, deadline: float) -> tuple[AskResponse, bool]:
    messages = _build_messages(body, db)

    tools_called: list[str] = []
    tools_succeeded: list[str] = []
    tool_results: list[str] = []
    degraded = False

    try:
        answer, provider = _run_with_tools(
            db, messages, tools_called, tools_succeeded, deadline, tool_results
        )
    except AllProvidersExhausted:
        try:
            answer, provider = _run_simple_mode(db, body.filters, messages)
        except Exception:
            # Simple mode makes its own LLM call (and a DB query) — if that
            # fails too, return a graceful degraded answer instead of a 500,
            # and never cache it: the very next attempt may succeed (#293).
            logger.exception("Simple-mode fallback failed after provider exhaustion")
            return _providers_exhausted_response(body, tools_called), False
        degraded = True

    return _finalize_answer(
        body, answer, provider, tools_called, tools_succeeded, tool_results, degraded
    )


def _finalize_answer(
    body: AskRequest,
    answer: str,
    provider: str,
    tools_called: list[str],
    tools_succeeded: list[str],
    tool_results: list[str],
    degraded: bool,
) -> tuple[AskResponse, bool]:
    """Post-process a raw model answer into (AskResponse, cacheable).

    Suggestion/chart extraction, the tool-grounding check and the cacheability
    rules all live here so the streaming endpoint ends up with exactly the
    payload the JSON endpoint would have returned.
    """
    suggestions = _parse_suggestions(answer)
    chart = _parse_chart(answer)
    clean_answer = _strip_suggestions(_strip_chart(answer))

    # grounded means "this answer is backed by at least one tool query that
    # actually executed" — attempted-but-failed calls don't count, or a run
    # where every tool errored would still present as data-backed.
    tool_grounded = len(tools_succeeded) > 0
    # Cacheability keys off tool success only: the numeric heuristic below is
    # deliberately conservative and can false-negative on heavily rounded
    # answers, so it downgrades the reported flag without evicting the answer.
    cacheable = not degraded and tool_grounded

    # A trend word its own figures contradict ("a modest rebound" over a
    # series that kept falling) is flagged to the reader, not silently
    # rewritten, and never cached: the next ask may word it correctly.
    trend_notes = trend_word_contradictions(clean_answer, chart)
    if trend_notes:
        logger.warning("Answer's trend words contradict its own figures: %s", trend_notes)
        clean_answer += "\n\n> **Check the numbers:** " + " ".join(trend_notes)
        cacheable = False

    grounded = tool_grounded
    # Calling a tool is not the same as citing it: cross-check that the raw
    # answer (chart included) shares at least one distinctive number with the
    # successful tool results. Only downgrade on zero overlap when the tool
    # results actually contained distinctive numbers (#293).
    if grounded and not answer_cites_tool_numbers(answer, tool_results):
        logger.warning(
            "Answer shares no distinctive numbers with tool results; "
            "downgrading grounded=false (tools_called=%s)",
            tools_called,
        )
        grounded = False

    return AskResponse(
        answer=clean_answer,
        provider=provider,
        suggestions=suggestions,
        chart=chart,
        grounded=grounded,
        filters_used=body.filters,
        tools_called=tools_called,
    ), cacheable


def _run_with_tools(
    db: Session,
    messages: list[dict],
    tools_called: list[str],
    tools_succeeded: list[str],
    deadline: float,
    tool_results: list[str] | None = None,
) -> tuple[str, str]:
    """Non-streaming tool loop — drains :func:`_run_with_tools_gen`."""
    gen = _run_with_tools_gen(db, messages, tools_called, tools_succeeded, deadline, tool_results)
    try:
        while True:
            next(gen)
    except StopIteration as stop:
        return stop.value


def _run_with_tools_gen(
    db: Session,
    messages: list[dict],
    tools_called: list[str],
    tools_succeeded: list[str],
    deadline: float,
    tool_results: list[str] | None = None,
    stream: bool = False,
) -> Iterator[Any]:
    """Run the tool-calling loop (max 3 rounds), returning (answer, provider).

    Round 0: tool_choice="required" — forces at least one tool call
    Round 1+: tool_choice="auto" — model can call more tools OR respond with text

    With ``stream=True`` every round after the forced tool round is requested
    with ``stream=True`` and its content deltas are yielded as they arrive.
    Round 0 is never streamed: it exists to produce tool calls, not prose.
    A streamed round that turns out to be a tool call yields ``_RESET`` so the
    discarded preamble is dropped on the client too, instead of staying glued
    to the front of the real answer until ``done`` replaces it.
    """
    provider = "unknown"
    for round_num in range(_MAX_TOOL_ROUNDS):
        # The client got its 504 once the deadline passed — every further
        # LLM round would burn provider quota for an answer nobody reads.
        if time.monotonic() >= deadline:
            raise _AskAbandoned()
        tc = "required" if round_num == 0 else "auto"
        streamed_round = stream and round_num > 0
        message, provider = yield from _complete(
            messages, tool_choice=tc, stream=streamed_round
        )
        has_tools = bool(message.tool_calls)
        logger.info("Round %d: provider=%s tool_choice=%s has_tool_calls=%s", round_num, provider, tc, has_tools)

        if not message.tool_calls and round_num == 0:
            logger.warning("Round 0: no tool call despite required. Nudging model.")
            messages.append({"role": "assistant", "content": message.content or ""})
            messages.append({"role": "user", "content": "Please use one of your available tools to query the CalSight database and answer with real data."})
            continue

        if message.tool_calls:
            if streamed_round:
                # Anything streamed this round was a preamble to a tool call,
                # not part of the answer — tell the reader to drop it.
                yield _RESET
            capped_calls = message.tool_calls[:_MAX_TOOL_CALLS_PER_ROUND]
            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                        # Gemini's thought signature; app.llm fits it per provider.
                        **(
                            {"extra_content": tc.extra_content}
                            if getattr(tc, "extra_content", None) else {}
                        ),
                    }
                    for tc in capped_calls
                ],
            }
            messages.append(assistant_msg)
            for tool_call in capped_calls:
                fn_name = tool_call.function.name
                yield _tool_status(fn_name, tool_call.function.arguments)
                tools_called.append(fn_name)
                succeeded = False
                try:
                    args = json.loads(tool_call.function.arguments)
                    fn = TOOL_REGISTRY.get(fn_name)
                    if fn:
                        result = fn(db, **args)
                        tools_succeeded.append(fn_name)
                        succeeded = True
                    else:
                        result = {"error": f"Unknown tool: {fn_name}"}
                except Exception as e:
                    logger.warning("Tool %s failed: %s", fn_name, e)
                    # A failed query aborts the session's transaction; without
                    # a rollback every subsequent tool call in this loop dies
                    # with PendingRollbackError. SET LOCAL statement_timeout
                    # dies with the transaction too, so re-apply it — later
                    # tools must stay bounded.
                    try:
                        db.rollback()
                        _apply_statement_timeout(db)
                    except Exception:
                        logger.exception("Failed to reset ask DB session after tool error")
                    result = {"error": "Tool execution failed. Please try again or rephrase your question."}

                serialized = json.dumps(result, default=str)
                # Collect successful results for the numeric-grounding check —
                # error payloads carry no data the answer could cite.
                if succeeded and tool_results is not None:
                    tool_results.append(serialized)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": serialized,
                })
            yield _Status("Reading the results...")
        else:
            return message.content or "", provider

    # Final round called tools — send one more LLM call to process results
    if messages and messages[-1].get("role") == "tool":
        message, provider = yield from _complete(messages, tool_choice="none", stream=stream)

    return message.content or "", provider


def _complete(
    messages: list[dict],
    tool_choice: str,
    stream: bool,
) -> Iterator[Any]:
    """One LLM round over the shared provider chain.

    Yields content deltas when ``stream`` is set; returns (message, provider).
    A provider that fails before its first token is skipped by the chain walk
    in ``app.llm`` exactly as in the non-streaming path.
    """
    if not stream:
        response, provider = generate_with_fallback(
            messages=messages,
            tools=TOOL_DEFINITIONS,
            tool_choice=tool_choice,
            max_tokens=1200,
        )
        return response.choices[0].message, provider

    chunks, provider = generate_with_fallback(
        messages=messages,
        tools=TOOL_DEFINITIONS,
        tool_choice=tool_choice,
        max_tokens=1200,
        stream=True,
    )
    message = yield from consume_stream(chunks)
    return message, provider


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
