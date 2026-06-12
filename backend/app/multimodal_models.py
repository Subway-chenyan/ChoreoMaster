from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.models import AIChoreoPlan


class MediaFileRef(BaseModel):
    name: str
    uri: str
    mime_type: str = Field(alias="mimeType")
    local_path: str = Field(alias="localPath")
    temporary: bool = True

    model_config = {"populate_by_name": True}


class TimedInsight(BaseModel):
    timestamp_ms: int = Field(alias="timestampMs", ge=0)
    label: str
    description: str
    confidence: float = Field(default=0.8, ge=0, le=1)

    model_config = {"populate_by_name": True}


class AudioAnalysis(BaseModel):
    segment_start_ms: int = Field(alias="segmentStartMs")
    segment_end_ms: int = Field(alias="segmentEndMs")
    estimated_bpm: float = Field(alias="estimatedBpm", ge=1)
    rhythmic_feel: str = Field(alias="rhythmicFeel")
    dynamics: str
    emotion: str
    significant_moments: list[TimedInsight] = Field(alias="significantMoments")
    formation_change_candidates: list[TimedInsight] = Field(
        alias="formationChangeCandidates",
        min_length=2,
    )

    model_config = {"populate_by_name": True}


class SketchElement(BaseModel):
    id: str
    shape: Literal["ellipse", "triangle", "rectangle", "square", "line", "other"]
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    width: float = Field(ge=0, le=100)
    height: float = Field(ge=0, le=100)
    label: str | None = None
    possible_role: Literal["actor", "prop", "unknown"] = Field(
        default="unknown",
        alias="possibleRole",
    )
    confidence: float = Field(default=0.7, ge=0, le=1)

    model_config = {"populate_by_name": True}


class SketchAnalysis(BaseModel):
    stage_orientation: Literal["top_is_back", "bottom_is_back", "left_is_back", "right_is_back", "unknown"] = Field(
        alias="stageOrientation"
    )
    elements: list[SketchElement]
    spatial_summary: str = Field(alias="spatialSummary")
    ambiguities: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class PropDimensions(BaseModel):
    width: float = Field(default=1, gt=0, le=20)
    depth: float = Field(default=0.3, gt=0, le=20)
    height: float = Field(default=2, gt=0, le=20)


class SketchMapping(BaseModel):
    actor_element_ids: list[str] = Field(alias="actorElementIds")
    prop_element_ids: list[str] = Field(alias="propElementIds")
    prop_dimensions: dict[str, PropDimensions] = Field(
        default_factory=dict,
        alias="propDimensions",
    )
    stage_orientation: Literal["top_is_back", "bottom_is_back", "left_is_back", "right_is_back"] = Field(
        alias="stageOrientation"
    )
    notes: str = ""

    model_config = {"populate_by_name": True}


class ProposedFormation(BaseModel):
    id: str
    name: str
    time_ms: int = Field(alias="timeMs")
    description: str
    source_element_ids: list[str] = Field(default_factory=list, alias="sourceElementIds")

    model_config = {"populate_by_name": True}


class InitialDesignProposal(BaseModel):
    summary: str
    formations: list[ProposedFormation]
    questions: list[str]
    risks: list[str] = Field(default_factory=list)


class DesignSummary(BaseModel):
    summary: str
    music_rationale: str = Field(alias="musicRationale")
    sketch_rationale: str = Field(alias="sketchRationale")
    formation_sequence: list[str] = Field(alias="formationSequence")
    risks: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class ChoreoDraft(BaseModel):
    id: str
    session_id: str = Field(alias="sessionId")
    plan: AIChoreoPlan
    validation: dict[str, Any]

    model_config = {"populate_by_name": True}


class TestSessionCreateRequest(BaseModel):
    audio_path: str | None = Field(default=None, alias="audioPath")
    sketch_path: str | None = Field(default=None, alias="sketchPath")
    segment_start_ms: int = Field(default=0, alias="segmentStartMs", ge=0)
    segment_end_ms: int = Field(default=30000, alias="segmentEndMs", gt=0)
    user_requirements: str = Field(
        default="",
        alias="userRequirements",
    )

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def require_at_least_one_input(self):
        if not self.user_requirements.strip() and not self.audio_path and not self.sketch_path:
            raise ValueError("文本、音频、图片至少提供一种。")
        return self


class TestSessionResumeRequest(BaseModel):
    action: Literal["approve", "edit", "reject"]
    feedback: str = ""
    mapping: SketchMapping | None = None


class TestSessionResponse(BaseModel):
    id: str
    status: str
    phase: str
    interrupt: dict[str, Any] | None = None
    audio_analysis: AudioAnalysis | None = Field(default=None, alias="audioAnalysis")
    sketch_analysis: SketchAnalysis | None = Field(default=None, alias="sketchAnalysis")
    initial_proposal: InitialDesignProposal | None = Field(default=None, alias="initialProposal")
    design_summary: DesignSummary | None = Field(default=None, alias="designSummary")
    draft: ChoreoDraft | None = None
    call_log: list[dict[str, Any]] = Field(default_factory=list, alias="callLog")

    model_config = {"populate_by_name": True}


class CheckpointInfo(BaseModel):
    checkpoint_id: str = Field(alias="checkpointId")
    phase: str
    created_at: str | None = Field(default=None, alias="createdAt")
    next_nodes: list[str] = Field(default_factory=list, alias="nextNodes")

    model_config = {"populate_by_name": True}
