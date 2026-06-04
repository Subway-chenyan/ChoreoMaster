from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Position(BaseModel):
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    z: float | None = None


class Performer(BaseModel):
    id: str
    name: str
    color: str
    label: str = ""
    shape: Literal["circle", "square", "triangle"] = "circle"
    group_id: str | None = Field(default=None, alias="groupId")
    type: Literal["performer", "prop"] = "performer"
    width: float | None = None
    height: float | None = None
    depth: float | None = None
    rotation: float | None = None
    prop_geometry_type: Literal["box", "extruded"] | None = Field(
        default=None,
        alias="propGeometryType",
    )

    model_config = ConfigDict(populate_by_name=True)


class PerformerGroup(BaseModel):
    id: str
    name: str
    color: str
    collapsed: bool = False
    type: Literal["performer", "prop"] = "performer"


class Frame(BaseModel):
    id: str
    name: str
    start_time: int = Field(alias="startTime")
    duration: int
    positions: dict[str, Position]
    notes: str | None = None
    hidden_group_ids: list[str] | None = Field(default=None, alias="hiddenGroupIds")

    model_config = ConfigDict(populate_by_name=True)


class StageConfig(BaseModel):
    width: float = 20
    depth: float = 11.25
    led_height: float | None = Field(default=None, alias="ledHeight")

    model_config = ConfigDict(populate_by_name=True)


class ProjectSnapshot(BaseModel):
    performers: list[Performer] = Field(default_factory=list)
    performer_groups: list[PerformerGroup] = Field(
        default_factory=list,
        alias="performerGroups",
    )
    frames: list[Frame] = Field(default_factory=list)
    stage_config: StageConfig = Field(default_factory=StageConfig, alias="stageConfig")

    model_config = ConfigDict(populate_by_name=True)


class AIChoreoRequest(BaseModel):
    prompt: str
    task_type: Literal[
        "auto",
        "initialize_project",
        "create_entities",
        "generate_formation",
        "generate_motion_frames",
    ] = Field(default="auto", alias="taskType")
    project: ProjectSnapshot = Field(default_factory=ProjectSnapshot)
    selected_performer_ids: list[str] = Field(
        default_factory=list,
        alias="selectedPerformerIds",
    )
    current_frame_id: str | None = Field(default=None, alias="currentFrameId")
    apply_mode: Literal["preview", "direct"] = Field(default="preview", alias="applyMode")

    model_config = ConfigDict(populate_by_name=True)


class AIGroupCreate(BaseModel):
    temp_id: str = Field(alias="tempId")
    name: str
    color: str
    type: Literal["performer", "prop"] = "performer"

    model_config = ConfigDict(populate_by_name=True)


class AIEntityCreate(BaseModel):
    temp_id: str = Field(alias="tempId")
    type: Literal["performer", "prop"]
    name: str
    color: str
    label: str = ""
    shape: Literal["circle", "square", "triangle"] = "circle"
    group_temp_id: str | None = Field(default=None, alias="groupTempId")
    width: float | None = None
    height: float | None = None
    depth: float | None = None
    rotation: float | None = None
    prop_geometry_type: Literal["box", "extruded"] | None = Field(
        default=None,
        alias="propGeometryType",
    )

    model_config = ConfigDict(populate_by_name=True)


class AIFrameCreate(BaseModel):
    temp_id: str = Field(alias="tempId")
    name: str
    start_time: int = Field(alias="startTime")
    duration: int = 2000
    positions: dict[str, Position]
    notes: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class AIPositionUpdate(BaseModel):
    frame_id: str = Field(alias="frameId")
    positions: dict[str, Position]

    model_config = ConfigDict(populate_by_name=True)


class AIChoreoPlan(BaseModel):
    intent: Literal[
        "initialize_project",
        "create_entities",
        "generate_formation",
        "generate_motion_frames",
    ]
    summary: str
    groups_to_create: list[AIGroupCreate] = Field(
        default_factory=list,
        alias="groupsToCreate",
    )
    entities_to_create: list[AIEntityCreate] = Field(
        default_factory=list,
        alias="entitiesToCreate",
    )
    frames_to_create: list[AIFrameCreate] = Field(
        default_factory=list,
        alias="framesToCreate",
    )
    position_updates: list[AIPositionUpdate] = Field(
        default_factory=list,
        alias="positionUpdates",
    )
    warnings: list[str] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True)


class DebugStep(BaseModel):
    node: str
    output: dict


class AIChoreoDebugResponse(BaseModel):
    plan: AIChoreoPlan
    steps: list[DebugStep]
