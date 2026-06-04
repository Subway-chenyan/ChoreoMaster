from __future__ import annotations

import os
from typing import Any

import httpx

from app.models import AIChoreoPlan, AIChoreoRequest


def generate_plan_with_model(
    request: AIChoreoRequest,
    intent: str,
    requirements: dict[str, Any],
    resolved_context: dict[str, Any],
) -> AIChoreoPlan | None:
    """Call the membership-backed model gateway when it is configured.

    This keeps the LangGraph node model-ready without hard-coding one vendor in
    the app. The gateway is expected to return either an AIChoreoPlan JSON object
    directly, or {"plan": AIChoreoPlan}.
    """
    endpoint = os.getenv("CHOREO_AGENT_MODEL_URL", "").strip()
    if not endpoint:
        return None

    token = os.getenv("CHOREO_AGENT_MODEL_TOKEN", "").strip()
    timeout = float(os.getenv("CHOREO_AGENT_MODEL_TIMEOUT", "30"))
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    payload = {
        "prompt": request.prompt,
        "intent": intent,
        "requirements": requirements,
        "resolvedContext": resolved_context,
        "project": request.project.model_dump(by_alias=True),
        "responseSchema": "AIChoreoPlan",
    }

    response = httpx.post(endpoint, json=payload, headers=headers, timeout=timeout)
    response.raise_for_status()
    data = response.json()
    return AIChoreoPlan.model_validate(data.get("plan", data))
