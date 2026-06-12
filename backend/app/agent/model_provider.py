from __future__ import annotations

import json
import os
from typing import Any

import httpx

from app.models import AIChoreoPlan, AIChoreoRequest, AIFrameCreate, Position


def _extract_json_content(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1]).strip()
    return json.loads(text)


def _normalize_plan_payload(payload: dict[str, Any]) -> dict[str, Any]:
    shape_aliases = {
        "box": "square",
        "rectangle": "square",
        "rect": "square",
        "圆形": "circle",
        "方形": "square",
        "矩形": "square",
        "三角形": "triangle",
    }
    for entity in payload.get("entitiesToCreate", []):
        shape = entity.get("shape")
        if isinstance(shape, str):
            normalized = shape_aliases.get(shape.lower(), shape_aliases.get(shape, shape))
            entity["shape"] = normalized
        elif entity.get("type") == "prop" and entity.get("propGeometryType") == "box":
            entity["shape"] = "square"
    return payload


def _enforce_motion_frame_count(
    plan: AIChoreoPlan,
    requirements: dict[str, Any],
    resolved_context: dict[str, Any],
) -> AIChoreoPlan:
    if plan.intent != "generate_motion_frames":
        return plan

    expected = int(requirements.get("rotation_frames") or 3)
    frames = list(plan.frames_to_create)
    if len(frames) == expected:
        return plan

    current_positions = resolved_context.get("current_positions") or {}
    if len(frames) == expected - 1 and current_positions:
        last_frame = frames[-1] if frames else None
        start_time = (
            last_frame.start_time + last_frame.duration
            if last_frame
            else int(resolved_context.get("current_frame_start", 0))
            + int(resolved_context.get("current_frame_duration", 2000))
        )
        duration = last_frame.duration if last_frame else 2000
        frames.append(
            AIFrameCreate(
                tempId=f"ai_frame_rotation_{expected}",
                name=f"旋转 {expected}/{expected}",
                startTime=start_time,
                duration=duration,
                positions={
                    performer_id: Position(**position)
                    for performer_id, position in current_positions.items()
                },
                notes="Agent 补齐：完成 360 度旋转并回到起始相对位置。",
            )
        )
        return plan.model_copy(
            update={
                "summary": f"将新增 {expected} 个关键队形完成一整圈旋转。",
                "frames_to_create": frames,
            }
        )

    raise ValueError(
        f"Model returned {len(frames)} motion frames; expected {expected}."
    )


def _generate_with_deepseek(
    request: AIChoreoRequest,
    intent: str,
    requirements: dict[str, Any],
    resolved_context: dict[str, Any],
) -> AIChoreoPlan:
    base_url = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com").rstrip("/")
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat").strip()
    timeout = float(os.getenv("CHOREO_AGENT_MODEL_TIMEOUT", "60"))
    if not api_key:
        raise ValueError("DEEPSEEK_API_KEY is required for the DeepSeek provider.")

    schema = AIChoreoPlan.model_json_schema(by_alias=True)
    system_prompt = (
        "你是专业舞台编队规划 Agent。只输出一个符合给定 JSON Schema 的 JSON 对象，"
        "不要输出 Markdown、解释或额外字段。舞台坐标采用百分比，x/y 范围为 0 到 100。"
        "必须保持已有演员 ID；新对象使用稳定且唯一的 tempId。"
        "生成多关键帧动作时，每个关键帧 positions 应包含当前队形的完整对象位置。"
        "rotation_frames 表示必须新增的关键帧数量，当前帧不计入其中；"
        "例如一整圈分三个队形时应新增 120、240、360 度三个关键帧。"
    )
    user_payload = {
        "instruction": request.prompt,
        "intent": intent,
        "requirements": requirements,
        "resolvedContext": resolved_context,
        "selectedPerformerIds": request.selected_performer_ids,
        "currentFrameId": request.current_frame_id,
        "project": request.project.model_dump(by_alias=True),
        "outputSchema": schema,
    }
    response = httpx.post(
        f"{base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": json.dumps(user_payload, ensure_ascii=False),
                },
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
            "max_tokens": 8192,
        },
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    payload = _normalize_plan_payload(_extract_json_content(content))
    plan = AIChoreoPlan.model_validate(payload)
    return _enforce_motion_frame_count(plan, requirements, resolved_context)


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
    provider = os.getenv(
        "CHOREO_AGENT_PROVIDER",
        os.getenv("LLM_PROVIDER", ""),
    ).strip().lower()
    if provider == "deepseek":
        return _generate_with_deepseek(
            request,
            intent,
            requirements,
            resolved_context,
        )

    if provider in {"", "rule", "local"}:
        return None

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
