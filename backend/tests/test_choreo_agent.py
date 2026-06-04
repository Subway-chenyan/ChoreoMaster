from app.agent import run_choreo_agent
from app.agent import choreo_graph
from app.models import AIChoreoPlan, AIChoreoRequest, Frame, Performer, Position, ProjectSnapshot


def test_initializes_performers_groups_and_door_props():
    request = AIChoreoRequest(
        prompt="帮我创建10个演员，分为5组，每组一个颜色，命名分别是A/B/C/D...，创建4个门板，高度为2m，长4m，宽0.3m",
        taskType="initialize_project",
    )

    plan, steps = run_choreo_agent(request)

    assert plan.intent == "initialize_project"
    assert len(plan.groups_to_create) == 5
    assert len([e for e in plan.entities_to_create if e.type == "performer"]) == 10
    assert len([e for e in plan.entities_to_create if e.type == "prop"]) == 4
    assert [e.name for e in plan.entities_to_create[:10]] == list("ABCDEFGHIJ")
    first_prop = [e for e in plan.entities_to_create if e.type == "prop"][0]
    assert first_prop.height == 2
    assert first_prop.width == 4
    assert first_prop.depth == 0.3
    assert [step.node for step in steps] == [
        "classify_intent",
        "extract_requirements",
        "resolve_project_context",
        "generate_plan",
        "validate_plan",
        "finalize_plan",
    ]


def test_generates_three_rotation_frames_around_actor_a():
    project = ProjectSnapshot(
        performers=[
            Performer(id="a", name="A", color="#fff", label="A"),
            Performer(id="b", name="B", color="#fff", label="B"),
            Performer(id="c", name="C", color="#fff", label="C"),
        ],
        frames=[
            Frame(
                id="f1",
                name="Formation 1",
                startTime=0,
                duration=2000,
                positions={
                    "a": Position(x=50, y=50),
                    "b": Position(x=60, y=50),
                    "c": Position(x=50, y=60),
                },
            )
        ],
    )
    request = AIChoreoRequest(
        prompt="围绕A 其他演员转动一整圈，分三个队形实现",
        project=project,
        currentFrameId="f1",
        selectedPerformerIds=["a", "b", "c"],
    )

    plan, _steps = run_choreo_agent(request)

    assert plan.intent == "generate_motion_frames"
    assert len(plan.frames_to_create) == 3
    assert plan.frames_to_create[0].start_time == 2000
    assert plan.frames_to_create[1].start_time == 4000
    assert plan.frames_to_create[2].start_time == 6000
    assert plan.frames_to_create[-1].positions["b"].x == 60
    assert plan.frames_to_create[-1].positions["b"].y == 50
    assert plan.frames_to_create[-1].positions["a"].x == 50
    assert plan.frames_to_create[-1].positions["a"].y == 50


def test_uses_configured_model_plan(monkeypatch):
    def fake_model_provider(request, intent, requirements, resolved_context):
        return AIChoreoPlan(
            intent="generate_formation",
            summary="模型生成的队形计划",
        )

    monkeypatch.setattr(choreo_graph, "generate_plan_with_model", fake_model_provider)

    plan, _steps = run_choreo_agent(
        AIChoreoRequest(prompt="生成一个菱形队形", taskType="generate_formation")
    )

    assert plan.summary == "模型生成的队形计划"
