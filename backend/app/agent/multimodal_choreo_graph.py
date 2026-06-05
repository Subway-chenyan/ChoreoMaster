from __future__ import annotations

import json
import mimetypes
import os
import shutil
import sqlite3
import tempfile
import uuid
from pathlib import Path
from typing import Any, TypedDict

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from app.agent.gemini_multimodal import (
    GeminiMultimodalProvider,
    create_session_temp_dir,
)
from app.models import AIChoreoPlan, AIEntityCreate, AIFrameCreate, Position
from app.multimodal_models import (
    AudioAnalysis,
    CheckpointInfo,
    ChoreoDraft,
    DesignSummary,
    InitialDesignProposal,
    MediaFileRef,
    PropDimensions,
    SketchAnalysis,
    SketchMapping,
    TestSessionCreateRequest,
    TestSessionResponse,
    TestSessionResumeRequest,
)


class MultimodalChoreoState(TypedDict, total=False):
    session_id: str
    request: dict[str, Any]
    phase: str
    status: str
    audio_ref: dict[str, Any]
    sketch_ref: dict[str, Any]
    session_temp_dir: str
    audio_analysis: dict[str, Any]
    sketch_analysis: dict[str, Any]
    initial_proposal: dict[str, Any]
    mapping: dict[str, Any]
    feedback: str
    design_summary: dict[str, Any]
    final_plan: dict[str, Any]
    draft: dict[str, Any]
    call_log: list[dict[str, Any]]
    final_decision: dict[str, Any]


def _database_path() -> str:
    default = Path(tempfile.gettempdir()) / "choreomaster-test-sessions.sqlite"
    path = Path(os.getenv("CHOREO_TEST_DB_PATH", str(default)))
    path.parent.mkdir(parents=True, exist_ok=True)
    return str(path)


_db_path = _database_path()
_checkpoint_connection = sqlite3.connect(_db_path, check_same_thread=False)
_checkpointer = SqliteSaver(_checkpoint_connection)
_session_connection = sqlite3.connect(_db_path, check_same_thread=False)
_session_connection.execute(
    """
    CREATE TABLE IF NOT EXISTS choreo_test_sessions (
        id TEXT PRIMARY KEY,
        request_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
    """
)
_session_connection.commit()


def get_multimodal_provider() -> GeminiMultimodalProvider:
    return GeminiMultimodalProvider()


def _append_call(
    state: MultimodalChoreoState,
    model: str,
    purpose: str,
) -> list[dict[str, Any]]:
    return [
        *state.get("call_log", []),
        {"model": model, "purpose": purpose},
    ]


def ingest_assets(state: MultimodalChoreoState) -> dict[str, Any]:
    request = TestSessionCreateRequest.model_validate(state["request"])
    audio_path = Path(request.audio_path)
    sketch_path = Path(request.sketch_path)
    if not audio_path.is_file():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    if not sketch_path.is_file():
        raise FileNotFoundError(f"Sketch file not found: {sketch_path}")
    if request.segment_end_ms <= request.segment_start_ms:
        raise ValueError("segmentEndMs must be later than segmentStartMs.")

    provider = get_multimodal_provider()
    temp_dir = create_session_temp_dir(state["session_id"])
    audio_segment_path = provider.prepare_audio_segment(
        str(audio_path),
        request.segment_start_ms,
        request.segment_end_ms,
        temp_dir,
    )
    audio_ref = provider.upload_file(audio_segment_path, "audio/wav")
    sketch_mime = mimetypes.guess_type(sketch_path.name)[0] or "image/jpeg"
    sketch_ref = provider.upload_file(str(sketch_path), sketch_mime)
    return {
        "phase": "assets_ingested",
        "status": "running",
        "session_temp_dir": temp_dir,
        "audio_ref": audio_ref.model_dump(by_alias=True),
        "sketch_ref": sketch_ref.model_dump(by_alias=True),
    }


def analyze_audio(state: MultimodalChoreoState) -> dict[str, Any]:
    request = TestSessionCreateRequest.model_validate(state["request"])
    provider = get_multimodal_provider()
    analysis = provider.analyze_audio(
        MediaFileRef.model_validate(state["audio_ref"]),
        request.segment_start_ms,
        request.segment_end_ms,
    )
    return {
        "phase": "audio_analyzed",
        "audio_analysis": analysis.model_dump(by_alias=True),
        "call_log": _append_call(state, provider.flash_model, "audio_analysis"),
    }


def analyze_sketch(state: MultimodalChoreoState) -> dict[str, Any]:
    provider = get_multimodal_provider()
    analysis = provider.analyze_sketch(
        MediaFileRef.model_validate(state["sketch_ref"])
    )
    return {
        "phase": "sketch_analyzed",
        "sketch_analysis": analysis.model_dump(by_alias=True),
        "call_log": _append_call(state, provider.flash_model, "sketch_analysis"),
    }


def generate_initial_proposal(state: MultimodalChoreoState) -> dict[str, Any]:
    provider = get_multimodal_provider()
    request = TestSessionCreateRequest.model_validate(state["request"])
    proposal = provider.generate_initial_proposal(
        AudioAnalysis.model_validate(state["audio_analysis"]),
        SketchAnalysis.model_validate(state["sketch_analysis"]),
        request.user_requirements,
    )
    return {
        "phase": "initial_proposal_ready",
        "initial_proposal": proposal.model_dump(by_alias=True),
        "call_log": _append_call(
            state,
            provider.flash_model,
            "initial_proposal",
        ),
    }


def await_initial_approval(state: MultimodalChoreoState) -> dict[str, Any]:
    while True:
        decision = interrupt(
            {
                "type": "initial_approval",
                "message": "请确认初步方案，并明确草图中的演员、道具和舞台方向。",
                "proposal": state["initial_proposal"],
                "sketchAnalysis": state["sketch_analysis"],
                "allowedActions": ["approve", "edit", "reject"],
            }
        )
        parsed = TestSessionResumeRequest.model_validate(decision)
        if parsed.action == "reject":
            continue
        if parsed.mapping is None:
            continue
        return {
            "phase": "initial_approved",
            "mapping": parsed.mapping.model_dump(by_alias=True),
            "feedback": parsed.feedback,
        }


def refine_design(state: MultimodalChoreoState) -> dict[str, Any]:
    provider = get_multimodal_provider()
    refined = provider.refine_design(
        InitialDesignProposal.model_validate(state["initial_proposal"]),
        SketchMapping.model_validate(state["mapping"]),
        state.get("feedback", ""),
        AudioAnalysis.model_validate(state["audio_analysis"]),
        SketchAnalysis.model_validate(state["sketch_analysis"]),
    )
    return {
        "phase": "design_refined",
        "initial_proposal": refined.model_dump(by_alias=True),
        "call_log": _append_call(state, provider.flash_model, "refine_design"),
    }


def generate_design_summary(state: MultimodalChoreoState) -> dict[str, Any]:
    provider = get_multimodal_provider()
    summary = provider.generate_design_summary(
        InitialDesignProposal.model_validate(state["initial_proposal"]),
        SketchMapping.model_validate(state["mapping"]),
        AudioAnalysis.model_validate(state["audio_analysis"]),
        SketchAnalysis.model_validate(state["sketch_analysis"]),
    )
    return {
        "phase": "design_summary_ready",
        "design_summary": summary.model_dump(by_alias=True),
        "call_log": _append_call(state, provider.pro_model, "design_summary"),
    }


def await_final_approval(state: MultimodalChoreoState) -> dict[str, Any]:
    decision = interrupt(
        {
            "type": "final_approval",
            "message": "请确认设计总结。批准后才会生成最终编排结构。",
            "summary": state["design_summary"],
            "allowedActions": ["approve", "edit", "reject"],
        }
    )
    parsed = TestSessionResumeRequest.model_validate(decision)
    return {
        "phase": "final_reviewed",
        "final_decision": parsed.model_dump(by_alias=True),
    }


def route_final_decision(state: MultimodalChoreoState) -> str:
    decision = state["final_decision"]
    return "generate" if decision["action"] == "approve" else "revise"


def apply_final_feedback(state: MultimodalChoreoState) -> dict[str, Any]:
    decision = TestSessionResumeRequest.model_validate(state["final_decision"])
    return {
        "phase": "final_revision_requested",
        "feedback": decision.feedback or "请根据最终审核意见继续修改。",
    }


def generate_final_structure(state: MultimodalChoreoState) -> dict[str, Any]:
    provider = get_multimodal_provider()
    request = TestSessionCreateRequest.model_validate(state["request"])
    plan = provider.generate_final_plan(
        InitialDesignProposal.model_validate(state["initial_proposal"]),
        DesignSummary.model_validate(state["design_summary"]),
        SketchMapping.model_validate(state["mapping"]),
        SketchAnalysis.model_validate(state["sketch_analysis"]),
        request.segment_start_ms,
        request.segment_end_ms,
    )
    return {
        "phase": "final_structure_ready",
        "final_plan": plan.model_dump(by_alias=True),
        "call_log": _append_call(state, provider.pro_model, "final_structure"),
    }


def _normalize_final_plan(
    plan: AIChoreoPlan,
    mapping: SketchMapping,
    sketch: SketchAnalysis,
    segment_start_ms: int,
    segment_end_ms: int,
) -> AIChoreoPlan:
    elements = {element.id: element for element in sketch.elements}
    actor_ids = mapping.actor_element_ids
    prop_ids = mapping.prop_element_ids

    source_actors = [
        entity for entity in plan.entities_to_create if entity.type == "performer"
    ]
    source_props = [
        entity for entity in plan.entities_to_create if entity.type == "prop"
    ]
    source_actor_ids = [entity.temp_id for entity in source_actors]
    source_prop_ids = [entity.temp_id for entity in source_props]

    entities: list[AIEntityCreate] = []
    for index, element_id in enumerate(actor_ids):
        element = elements[element_id]
        source = source_actors[index] if index < len(source_actors) else None
        entities.append(
            AIEntityCreate(
                tempId=element_id,
                type="performer",
                name=source.name if source else f"演员{index + 1}",
                color=source.color if source else "#3B82F6",
                label=source.label if source else "",
                shape="triangle" if element.shape == "triangle" else "circle",
                rotation=source.rotation if source else None,
            )
        )
    for index, element_id in enumerate(prop_ids):
        source = source_props[index] if index < len(source_props) else None
        dimensions = mapping.prop_dimensions.get(element_id, PropDimensions())
        entities.append(
            AIEntityCreate(
                tempId=element_id,
                type="prop",
                name=source.name if source else f"道具{index + 1}",
                color=source.color if source else "#64748B",
                label=source.label if source else "",
                shape="square",
                width=dimensions.width,
                height=dimensions.height,
                depth=dimensions.depth,
                rotation=source.rotation if source else None,
                propGeometryType=(
                    source.prop_geometry_type
                    if source and source.prop_geometry_type
                    else "box"
                ),
            )
        )

    frames: list[AIFrameCreate] = []
    for index, frame in enumerate(plan.frames_to_create):
        positions: dict[str, Position] = {}
        for target_index, element_id in enumerate(actor_ids):
            source_id = (
                source_actor_ids[target_index]
                if target_index < len(source_actor_ids)
                else element_id
            )
            positions[element_id] = frame.positions.get(
                source_id,
                Position(x=elements[element_id].x, y=elements[element_id].y),
            )
        for target_index, element_id in enumerate(prop_ids):
            source_id = (
                source_prop_ids[target_index]
                if target_index < len(source_prop_ids)
                else element_id
            )
            positions[element_id] = frame.positions.get(
                source_id,
                Position(x=elements[element_id].x, y=elements[element_id].y),
            )

        start_time = min(
            max(frame.start_time, segment_start_ms),
            segment_end_ms,
        )
        duration = min(max(frame.duration, 0), segment_end_ms - start_time)
        frames.append(
            AIFrameCreate(
                tempId=frame.temp_id or f"formation-{index + 1}",
                name=frame.name,
                startTime=start_time,
                duration=duration,
                positions=positions,
                notes=frame.notes,
            )
        )

    return plan.model_copy(
        update={
            "entities_to_create": entities,
            "frames_to_create": frames,
        }
    )


def validate_structure(state: MultimodalChoreoState) -> dict[str, Any]:
    request = TestSessionCreateRequest.model_validate(state["request"])
    mapping = SketchMapping.model_validate(state["mapping"])
    sketch = SketchAnalysis.model_validate(state["sketch_analysis"])
    plan = _normalize_final_plan(
        AIChoreoPlan.model_validate(state["final_plan"]),
        mapping,
        sketch,
        request.segment_start_ms,
        request.segment_end_ms,
    )
    expected_ids = set(mapping.actor_element_ids + mapping.prop_element_ids)
    entity_ids = {entity.temp_id for entity in plan.entities_to_create}
    errors: list[str] = []

    if not plan.frames_to_create:
        errors.append("Final plan has no key formations.")
    if not expected_ids.issubset(entity_ids):
        errors.append("Final plan does not create every mapped sketch element.")
    for frame in plan.frames_to_create:
        if not request.segment_start_ms <= frame.start_time <= request.segment_end_ms:
            errors.append(f"Frame {frame.name} is outside the selected segment.")
        missing = expected_ids - set(frame.positions)
        if missing:
            errors.append(
                f"Frame {frame.name} is missing positions for: {sorted(missing)}"
            )
    actor_ids = set(mapping.actor_element_ids)
    prop_ids = set(mapping.prop_element_ids)
    for entity in plan.entities_to_create:
        if entity.temp_id in actor_ids and entity.type != "performer":
            errors.append(f"{entity.temp_id} should be a performer.")
        if entity.temp_id in prop_ids and entity.type != "prop":
            errors.append(f"{entity.temp_id} should be a prop.")
    if errors:
        raise ValueError("Final structure validation failed: " + " | ".join(errors))

    draft = ChoreoDraft(
        id=str(uuid.uuid4()),
        sessionId=state["session_id"],
        plan=plan,
        validation={
            "valid": True,
            "segmentStartMs": request.segment_start_ms,
            "segmentEndMs": request.segment_end_ms,
            "entityCount": len(plan.entities_to_create),
            "frameCount": len(plan.frames_to_create),
        },
    )
    return {
        "phase": "draft_ready",
        "status": "completed",
        "draft": draft.model_dump(by_alias=True),
    }


def cleanup_assets(state: MultimodalChoreoState) -> dict[str, Any]:
    provider = get_multimodal_provider()
    for key in ("audio_ref", "sketch_ref"):
        if state.get(key):
            try:
                provider.delete_file(MediaFileRef.model_validate(state[key]))
            except Exception:
                pass
    temp_dir = state.get("session_temp_dir")
    if temp_dir:
        shutil.rmtree(temp_dir, ignore_errors=True)
    request = TestSessionCreateRequest.model_validate(state["request"])
    upload_root = Path(tempfile.gettempdir()) / "choreomaster-agent-uploads"
    for source_path in (Path(request.audio_path), Path(request.sketch_path)):
        try:
            resolved = source_path.resolve()
            if upload_root.resolve() in resolved.parents:
                shutil.rmtree(resolved.parent, ignore_errors=True)
        except OSError:
            pass
    return {"phase": "completed", "status": "completed"}


def build_multimodal_choreo_graph():
    builder = StateGraph(MultimodalChoreoState)
    builder.add_node("ingest_assets", ingest_assets)
    builder.add_node("analyze_audio", analyze_audio)
    builder.add_node("analyze_sketch", analyze_sketch)
    builder.add_node("generate_initial_proposal", generate_initial_proposal)
    builder.add_node("await_initial_approval", await_initial_approval)
    builder.add_node("refine_design", refine_design)
    builder.add_node("generate_design_summary", generate_design_summary)
    builder.add_node("await_final_approval", await_final_approval)
    builder.add_node("apply_final_feedback", apply_final_feedback)
    builder.add_node("generate_final_structure", generate_final_structure)
    builder.add_node("validate_structure", validate_structure)
    builder.add_node("cleanup_assets", cleanup_assets)

    builder.add_edge(START, "ingest_assets")
    builder.add_edge("ingest_assets", "analyze_audio")
    builder.add_edge("analyze_audio", "analyze_sketch")
    builder.add_edge("analyze_sketch", "generate_initial_proposal")
    builder.add_edge("generate_initial_proposal", "await_initial_approval")
    builder.add_edge("await_initial_approval", "refine_design")
    builder.add_edge("refine_design", "generate_design_summary")
    builder.add_edge("generate_design_summary", "await_final_approval")
    builder.add_conditional_edges(
        "await_final_approval",
        route_final_decision,
        {
            "generate": "generate_final_structure",
            "revise": "apply_final_feedback",
        },
    )
    builder.add_edge("apply_final_feedback", "refine_design")
    builder.add_edge("generate_final_structure", "validate_structure")
    builder.add_edge("validate_structure", "cleanup_assets")
    builder.add_edge("cleanup_assets", END)
    return builder.compile(checkpointer=_checkpointer)


multimodal_choreo_graph = build_multimodal_choreo_graph()


def create_test_session(request: TestSessionCreateRequest) -> str:
    session_id = str(uuid.uuid4())
    _session_connection.execute(
        "INSERT INTO choreo_test_sessions (id, request_json) VALUES (?, ?)",
        (session_id, request.model_dump_json(by_alias=True)),
    )
    _session_connection.commit()
    return session_id


def _load_request(session_id: str) -> TestSessionCreateRequest:
    row = _session_connection.execute(
        "SELECT request_json FROM choreo_test_sessions WHERE id = ?",
        (session_id,),
    ).fetchone()
    if row is None:
        raise KeyError(session_id)
    return TestSessionCreateRequest.model_validate_json(row[0])


def run_test_session(session_id: str):
    request = _load_request(session_id)
    config = {"configurable": {"thread_id": session_id}}
    snapshot = multimodal_choreo_graph.get_state(config)
    if snapshot.values:
        return snapshot.values
    return multimodal_choreo_graph.invoke(
        {
            "session_id": session_id,
            "request": request.model_dump(by_alias=True),
            "phase": "created",
            "status": "running",
            "call_log": [],
        },
        config=config,
    )


def resume_test_session(
    session_id: str,
    decision: TestSessionResumeRequest,
):
    _load_request(session_id)
    config = {"configurable": {"thread_id": session_id}}
    return multimodal_choreo_graph.invoke(
        Command(resume=decision.model_dump(by_alias=True)),
        config=config,
    )


def _interrupt_payload(snapshot) -> dict[str, Any] | None:
    for task in snapshot.tasks:
        for item in getattr(task, "interrupts", ()):
            value = getattr(item, "value", None)
            if isinstance(value, dict):
                return value
    return None


def get_test_session(session_id: str) -> TestSessionResponse:
    _load_request(session_id)
    config = {"configurable": {"thread_id": session_id}}
    snapshot = multimodal_choreo_graph.get_state(config)
    values = snapshot.values or {}
    interrupt_payload = _interrupt_payload(snapshot)
    status = values.get("status", "created")
    if interrupt_payload:
        status = "waiting_for_user"
    return TestSessionResponse(
        id=session_id,
        status=status,
        phase=values.get("phase", "created"),
        interrupt=interrupt_payload,
        audioAnalysis=values.get("audio_analysis"),
        sketchAnalysis=values.get("sketch_analysis"),
        initialProposal=values.get("initial_proposal"),
        designSummary=values.get("design_summary"),
        draft=values.get("draft"),
        callLog=values.get("call_log", []),
    )


def list_test_session_checkpoints(session_id: str) -> list[CheckpointInfo]:
    _load_request(session_id)
    config = {"configurable": {"thread_id": session_id}}
    checkpoints: list[CheckpointInfo] = []
    for snapshot in multimodal_choreo_graph.get_state_history(config):
        checkpoint = snapshot.config.get("configurable", {})
        metadata = snapshot.metadata or {}
        checkpoints.append(
            CheckpointInfo(
                checkpointId=str(checkpoint.get("checkpoint_id", "")),
                phase=(snapshot.values or {}).get("phase", "created"),
                createdAt=metadata.get("created_at"),
                nextNodes=list(snapshot.next),
            )
        )
    return checkpoints
