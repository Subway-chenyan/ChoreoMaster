from __future__ import annotations

import math
import re
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from app.agent.model_provider import generate_plan_with_model
from app.models import (
    AIChoreoPlan,
    AIChoreoRequest,
    AIEntityCreate,
    AIFrameCreate,
    AIGroupCreate,
    DebugStep,
    Position,
)


DEFAULT_COLORS = [
    "#EF4444",
    "#3B82F6",
    "#10B981",
    "#F59E0B",
    "#8B5CF6",
    "#EC4899",
    "#06B6D4",
    "#F97316",
]


class ChoreoState(TypedDict, total=False):
    request: AIChoreoRequest
    intent: Literal[
        "initialize_project",
        "create_entities",
        "generate_formation",
        "generate_motion_frames",
    ]
    requirements: dict[str, Any]
    resolved_context: dict[str, Any]
    plan: AIChoreoPlan
    steps: list[DebugStep]


def build_choreo_graph():
    graph = StateGraph(ChoreoState)
    graph.add_node("classify_intent", classify_intent)
    graph.add_node("extract_requirements", extract_requirements)
    graph.add_node("resolve_project_context", resolve_project_context)
    graph.add_node("generate_plan", generate_plan)
    graph.add_node("validate_plan", validate_plan)
    graph.add_node("finalize_plan", finalize_plan)

    graph.add_edge(START, "classify_intent")
    graph.add_edge("classify_intent", "extract_requirements")
    graph.add_edge("extract_requirements", "resolve_project_context")
    graph.add_edge("resolve_project_context", "generate_plan")
    graph.add_edge("generate_plan", "validate_plan")
    graph.add_edge("validate_plan", "finalize_plan")
    graph.add_edge("finalize_plan", END)
    return graph.compile()


def run_choreo_agent(request: AIChoreoRequest) -> tuple[AIChoreoPlan, list[DebugStep]]:
    result = build_choreo_graph().invoke({"request": request, "steps": []})
    return result["plan"], result.get("steps", [])


def classify_intent(state: ChoreoState) -> dict[str, Any]:
    request = state["request"]
    if request.task_type != "auto":
        intent = request.task_type
    else:
        prompt = request.prompt
        has_create = any(word in prompt for word in ["创建", "新建", "初始化", "添加"])
        has_motion = any(word in prompt for word in ["围绕", "转动", "旋转", "一整圈", "关键帧"])
        if has_motion:
            intent = "generate_motion_frames"
        elif "队形" in prompt and not has_create:
            intent = "generate_formation"
        elif "初始化" in prompt:
            intent = "initialize_project"
        else:
            intent = "create_entities" if has_create else "generate_formation"

    return {
        "intent": intent,
        "steps": _append_step(state, "classify_intent", {"intent": intent}),
    }


def extract_requirements(state: ChoreoState) -> dict[str, Any]:
    prompt = state["request"].prompt
    actor_count = _find_count_before(prompt, ["个演员", "名演员", "人"])
    group_count = _find_count_before(prompt, ["组"])
    prop_count = _find_count_before(prompt, ["个门板", "块门板", "个道具", "块道具"])
    requirements: dict[str, Any] = {
        "actor_count": actor_count,
        "group_count": group_count,
        "prop_count": prop_count,
        "prop_kind": "门板" if "门板" in prompt else "道具",
        "prop_dimensions": _extract_prop_dimensions(prompt),
        "rotation_frames": _find_count_before(prompt, ["个队形", "个关键帧"]) or 3,
        "center_name": _extract_center_name(prompt),
        "name_range": _extract_name_range(prompt, actor_count),
    }
    return {
        "requirements": requirements,
        "steps": _append_step(state, "extract_requirements", requirements),
    }


def resolve_project_context(state: ChoreoState) -> dict[str, Any]:
    request = state["request"]
    project = request.project
    requirements = state.get("requirements", {})
    current_frame = None
    if request.current_frame_id:
        current_frame = next(
            (frame for frame in project.frames if frame.id == request.current_frame_id),
            None,
        )
    if current_frame is None and project.frames:
        current_frame = project.frames[-1]

    center_name = requirements.get("center_name") or "A"
    center = next(
        (p for p in project.performers if p.name.lower() == center_name.lower()),
        None,
    )
    current_positions = current_frame.positions if current_frame else {}
    selected_ids = set(request.selected_performer_ids)
    if selected_ids:
        affected_ids = [
            p.id
            for p in project.performers
            if p.id in selected_ids and p.type == "performer"
        ]
    else:
        affected_ids = [
            p.id
            for p in project.performers
            if p.type == "performer" and p.id in current_positions
        ]
    if center:
        affected_ids = [pid for pid in affected_ids if pid != center.id]

    resolved = {
        "current_frame_id": current_frame.id if current_frame else None,
        "current_frame_start": current_frame.start_time if current_frame else 0,
        "current_frame_duration": current_frame.duration if current_frame else 2000,
        "center_id": center.id if center else None,
        "center_name": center_name,
        "center_position": (
            current_positions.get(center.id).model_dump() if center and center.id in current_positions else None
        ),
        "affected_ids": affected_ids,
        "current_positions": {
            pid: pos.model_dump() for pid, pos in current_positions.items()
        },
        "project_has_content": bool(project.performers or project.frames),
    }
    return {
        "resolved_context": resolved,
        "steps": _append_step(state, "resolve_project_context", resolved),
    }


def generate_plan(state: ChoreoState) -> dict[str, Any]:
    intent = state["intent"]
    requirements = state.get("requirements", {})
    resolved_context = state.get("resolved_context", {})
    try:
        plan = generate_plan_with_model(
            state["request"],
            intent,
            requirements,
            resolved_context,
        )
    except Exception as error:
        plan = None
        state.setdefault("requirements", {})["model_error"] = str(error)

    if plan is not None:
        pass
    elif intent in ["initialize_project", "create_entities"]:
        plan = _generate_entity_plan(state)
    elif intent == "generate_motion_frames":
        plan = _generate_rotation_plan(state)
    else:
        plan = AIChoreoPlan(
            intent="generate_formation",
            summary="已识别为队形生成请求；第一版后端会在接入模型后生成自由队形。",
            warnings=["规则版 Agent 暂不支持开放式队形生成，请接入模型节点后启用。"],
        )
    if state.get("requirements", {}).get("model_error"):
        plan = plan.model_copy(
            update={
                "warnings": [
                    *plan.warnings,
                    f"模型网关调用失败，已回退到规则版生成：{state['requirements']['model_error']}",
                ]
            }
        )
    return {
        "plan": plan,
        "steps": _append_step(state, "generate_plan", plan.model_dump(by_alias=True)),
    }


def validate_plan(state: ChoreoState) -> dict[str, Any]:
    plan = state["plan"]
    warnings = list(plan.warnings)
    stage_config = state["request"].project.stage_config
    wing_percent = (stage_config.wing_width / stage_config.width) * 100
    min_x = -wing_percent
    max_x = 100 + wing_percent
    for frame in plan.frames_to_create:
        for performer_id, pos in frame.positions.items():
            if not min_x <= pos.x <= max_x or not 0 <= pos.y <= 100:
                warnings.append(f"{frame.name} 中 {performer_id} 坐标越界，已限制到舞台范围。")
                frame.positions[performer_id] = Position(
                    x=_clamp(pos.x, min_x, max_x),
                    y=_clamp(pos.y),
                    z=pos.z,
                )
    validated = plan.model_copy(update={"warnings": warnings})
    return {
        "plan": validated,
        "steps": _append_step(
            state,
            "validate_plan",
            {"warnings": warnings, "frameCount": len(validated.frames_to_create)},
        ),
    }


def finalize_plan(state: ChoreoState) -> dict[str, Any]:
    plan = state["plan"]
    return {
        "plan": plan,
        "steps": _append_step(
            state,
            "finalize_plan",
            {
                "summary": plan.summary,
                "groups": len(plan.groups_to_create),
                "entities": len(plan.entities_to_create),
                "frames": len(plan.frames_to_create),
            },
        ),
    }


def _generate_entity_plan(state: ChoreoState) -> AIChoreoPlan:
    requirements = state.get("requirements", {})
    resolved = state.get("resolved_context", {})
    actor_count = requirements.get("actor_count") or 0
    group_count = requirements.get("group_count") or 0
    prop_count = requirements.get("prop_count") or 0
    actor_names = requirements.get("name_range") or _letter_names(actor_count)

    groups: list[AIGroupCreate] = []
    entities: list[AIEntityCreate] = []
    for index in range(group_count):
        groups.append(
            AIGroupCreate(
                tempId=f"ai_group_{index + 1}",
                name=f"Group {index + 1}",
                color=DEFAULT_COLORS[index % len(DEFAULT_COLORS)],
                type="performer",
            )
        )

    for index in range(actor_count):
        group_temp_id = None
        if group_count:
            group_index = min(index * group_count // max(actor_count, 1), group_count - 1)
            group_temp_id = f"ai_group_{group_index + 1}"
        color = DEFAULT_COLORS[(index * max(group_count, 1) // max(actor_count, 1)) % len(DEFAULT_COLORS)]
        name = actor_names[index] if index < len(actor_names) else f"演员{index + 1}"
        entities.append(
            AIEntityCreate(
                tempId=f"ai_actor_{index + 1}",
                type="performer",
                name=name,
                label=name[:1].upper(),
                color=color,
                shape="circle",
                groupTempId=group_temp_id,
            )
        )

    dimensions = requirements.get("prop_dimensions") or {}
    for index in range(prop_count):
        entities.append(
            AIEntityCreate(
                tempId=f"ai_prop_{index + 1}",
                type="prop",
                name=f"{requirements.get('prop_kind', '道具')}{index + 1}",
                label=str(index + 1),
                color="#64748B",
                shape="square",
                width=dimensions.get("width"),
                height=dimensions.get("height"),
                depth=dimensions.get("depth"),
                propGeometryType="box",
            )
        )

    warnings = []
    if resolved.get("project_has_content"):
        warnings.append("当前项目已有内容，应用前请让用户选择覆盖或追加。")

    return AIChoreoPlan(
        intent=state["intent"],
        summary=f"将创建 {len(entities)} 个对象，其中演员 {actor_count} 个，道具 {prop_count} 个，分组 {group_count} 个。",
        groupsToCreate=groups,
        entitiesToCreate=entities,
        warnings=warnings,
    )


def _generate_rotation_plan(state: ChoreoState) -> AIChoreoPlan:
    requirements = state.get("requirements", {})
    resolved = state.get("resolved_context", {})
    frame_count = int(requirements.get("rotation_frames") or 3)
    center_position = resolved.get("center_position")
    current_positions = resolved.get("current_positions") or {}
    affected_ids = resolved.get("affected_ids") or []
    warnings = []
    if not center_position:
        warnings.append(f"未找到中心演员 {resolved.get('center_name', 'A')} 或其当前队形位置。")
    if not affected_ids:
        warnings.append("没有找到可围绕中心旋转的演员。")
    if not center_position or not affected_ids:
        return AIChoreoPlan(
            intent="generate_motion_frames",
            summary="无法生成旋转队形，请先确认中心演员和目标演员存在于当前队形。",
            warnings=warnings,
        )

    frames: list[AIFrameCreate] = []
    start = resolved.get("current_frame_start", 0) + resolved.get("current_frame_duration", 2000)
    duration = 2000
    for index in range(frame_count):
        angle = 2 * math.pi * (index + 1) / frame_count
        positions: dict[str, Position] = {}
        for performer_id, raw in current_positions.items():
            if performer_id in affected_ids:
                positions[performer_id] = _rotate_position(raw, center_position, angle)
            else:
                positions[performer_id] = Position(**raw)
        frames.append(
            AIFrameCreate(
                tempId=f"ai_frame_rotation_{index + 1}",
                name=f"围绕{resolved.get('center_name', 'A')}旋转 {index + 1}/{frame_count}",
                startTime=start + index * duration,
                duration=duration,
                positions=positions,
                notes="AI 生成：围绕中心演员旋转一整圈。",
            )
        )

    return AIChoreoPlan(
        intent="generate_motion_frames",
        summary=f"将新增 {frame_count} 个关键队形，让 {len(affected_ids)} 名演员围绕 {resolved.get('center_name', 'A')} 转动一整圈。",
        framesToCreate=frames,
        warnings=warnings,
    )


def _append_step(state: ChoreoState, node: str, output: dict[str, Any]) -> list[DebugStep]:
    return [*state.get("steps", []), DebugStep(node=node, output=output)]


def _find_count_before(prompt: str, suffixes: list[str]) -> int | None:
    for suffix in suffixes:
        match = re.search(rf"(\d+)\s*{re.escape(suffix)}", prompt)
        if match:
            return int(match.group(1))
    return None


def _extract_prop_dimensions(prompt: str) -> dict[str, float]:
    dimensions: dict[str, float] = {}
    patterns = {
        "height": ["高", "高度"],
        "width": ["长", "长度"],
        "depth": ["宽", "宽度", "厚", "厚度"],
    }
    for key, labels in patterns.items():
        for label in labels:
            match = re.search(rf"{label}(?:为)?\s*(\d+(?:\.\d+)?)\s*m?", prompt, re.I)
            if match:
                dimensions[key] = float(match.group(1))
                break
    return dimensions


def _extract_center_name(prompt: str) -> str | None:
    match = re.search(r"围绕\s*([A-Za-z0-9\u4e00-\u9fa5]+)", prompt)
    if not match:
        return None
    name = match.group(1)
    return re.sub(r"(其他演员|演员|转动|旋转).*", "", name).strip() or None


def _extract_name_range(prompt: str, count: int | None) -> list[str]:
    if not count:
        return []
    if re.search(r"A\\?/?B\\?/?C|A\s*到\s*[A-Z]|A\.\.\.", prompt, re.I):
        return _letter_names(count)
    if "A" in prompt and "B" in prompt and "C" in prompt:
        return _letter_names(count)
    return []


def _letter_names(count: int) -> list[str]:
    names = []
    for index in range(count):
        if index < 26:
            names.append(chr(ord("A") + index))
        else:
            names.append(f"A{index - 25}")
    return names


def _rotate_position(raw: dict[str, Any], center: dict[str, Any], angle: float) -> Position:
    dx = float(raw["x"]) - float(center["x"])
    dy = float(raw["y"]) - float(center["y"])
    return Position(
        x=_clamp(float(center["x"]) + dx * math.cos(angle) - dy * math.sin(angle)),
        y=_clamp(float(center["y"]) + dx * math.sin(angle) + dy * math.cos(angle)),
        z=raw.get("z"),
    )


def _clamp(value: float, lower: float = 2, upper: float = 98) -> float:
    return max(lower, min(upper, value))
