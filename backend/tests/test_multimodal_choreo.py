from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent import multimodal_choreo_graph
from app.main import app
from app.models import (
    AIChoreoPlan,
    AIEntityCreate,
    AIFrameCreate,
    Position,
)
from app.multimodal_models import (
    AudioAnalysis,
    DesignSummary,
    InitialDesignProposal,
    MediaFileRef,
    ProposedFormation,
    SketchAnalysis,
    SketchElement,
)


class FakeGeminiProvider:
    flash_model = "gemini-2.5-flash"
    pro_model = "gemini-2.5-pro"

    def prepare_audio_segment(self, source_path, start_ms, end_ms, output_dir):
        target = Path(output_dir) / "segment.wav"
        shutil.copyfile(source_path, target)
        return str(target)

    def upload_file(self, path, mime_type=None):
        return MediaFileRef(
            name=f"files/{Path(path).name}",
            uri=f"https://example.test/{Path(path).name}",
            mimeType=mime_type or "application/octet-stream",
            localPath=path,
        )

    def delete_file(self, file_ref):
        return None

    def analyze_audio(self, audio_ref, start_ms, end_ms):
        return AudioAnalysis(
            segmentStartMs=start_ms,
            segmentEndMs=end_ms,
            estimatedBpm=84,
            rhythmicFeel="缓慢但有持续推进感",
            dynamics="由弱渐强",
            emotion="克制、建筑感、逐渐紧张",
            significantMoments=[
                {
                    "timestampMs": 0,
                    "label": "开场",
                    "description": "低能量进入",
                },
                {
                    "timestampMs": 15000,
                    "label": "发展",
                    "description": "能量增强",
                },
            ],
            formationChangeCandidates=[
                {
                    "timestampMs": 9000,
                    "label": "候选一",
                    "description": "节奏层次变化",
                },
                {
                    "timestampMs": 21000,
                    "label": "候选二",
                    "description": "动态增强",
                },
            ],
        )

    def analyze_sketch(self, sketch_ref):
        elements = [
            SketchElement(
                id="rect-left",
                shape="rectangle",
                x=20,
                y=30,
                width=8,
                height=28,
                possibleRole="unknown",
            ),
            SketchElement(
                id="rect-right",
                shape="rectangle",
                x=25,
                y=80,
                width=8,
                height=26,
                possibleRole="unknown",
            ),
            SketchElement(
                id="square",
                shape="square",
                x=27,
                y=55,
                width=8,
                height=8,
                possibleRole="unknown",
            ),
            SketchElement(
                id="ellipse-1",
                shape="ellipse",
                x=50,
                y=25,
                width=12,
                height=8,
                possibleRole="unknown",
            ),
            SketchElement(
                id="ellipse-2",
                shape="ellipse",
                x=70,
                y=40,
                width=10,
                height=7,
                possibleRole="unknown",
            ),
            SketchElement(
                id="ellipse-3",
                shape="ellipse",
                x=80,
                y=58,
                width=10,
                height=7,
                possibleRole="unknown",
            ),
            SketchElement(
                id="ellipse-4",
                shape="ellipse",
                x=55,
                y=78,
                width=11,
                height=7,
                possibleRole="unknown",
            ),
            SketchElement(
                id="triangle-1",
                shape="triangle",
                x=44,
                y=48,
                width=8,
                height=8,
                possibleRole="unknown",
            ),
            SketchElement(
                id="triangle-2",
                shape="triangle",
                x=45,
                y=65,
                width=8,
                height=8,
                possibleRole="unknown",
            ),
        ]
        return SketchAnalysis(
            stageOrientation="unknown",
            elements=elements,
            spatialSummary="两个长矩形位于左侧，多个椭圆沿右侧分布。",
            ambiguities=["图形角色未知", "舞台前后方向未知"],
            questions=[
                "哪些图形表示演员，哪些表示道具？",
                "图片哪一侧是舞台后方？",
            ],
        )

    def generate_initial_proposal(
        self,
        audio,
        sketch,
        requirements,
        start_ms,
        end_ms,
    ):
        return InitialDesignProposal(
            summary="根据当前可用输入，在片段内切换三组关键队形。",
            formations=[
                ProposedFormation(
                    id="formation-1",
                    name="静态开场",
                    timeMs=start_ms,
                    description="建立清晰的初始空间关系。",
                ),
                ProposedFormation(
                    id="formation-2",
                    name="中段展开",
                    timeMs=min(start_ms + 9000, end_ms),
                    description="演员向舞台两侧展开。",
                ),
                ProposedFormation(
                    id="formation-3",
                    name="高潮收束",
                    timeMs=min(start_ms + 21000, end_ms),
                    description="演员重新聚合。",
                ),
            ],
            questions=sketch.questions if sketch else [],
        )

    def refine_design(self, proposal, mapping, feedback, audio, sketch):
        return proposal.model_copy(
            update={
                "summary": "已按用户确认的演员、道具和舞台方向完善方案。",
                "questions": [],
            }
        )

    def generate_design_summary(self, proposal, mapping, audio, sketch):
        return DesignSummary(
            summary="三段关键队形从克制开场逐步发展到集中收束。",
            musicRationale=(
                "队形切换对应音乐变化。"
                if audio
                else "本次未使用音频输入。"
            ),
            sketchRationale=(
                "矩形和方形作为道具，椭圆和三角形作为演员。"
                if sketch
                else "本次未使用草图输入。"
            ),
            formationSequence=[formation.name for formation in proposal.formations],
            risks=["演员靠近道具时需检查间距。"],
        )

    def generate_final_plan(
        self,
        proposal,
        summary,
        mapping,
        sketch,
        start_ms,
        end_ms,
    ):
        if sketch is None:
            entities = [
                AIEntityCreate(
                    tempId=f"actor-{index + 1}",
                    type="performer",
                    name=f"演员{index + 1}",
                    color="#3B82F6",
                )
                for index in range(4)
            ]
            positions = {
                entity.temp_id: Position(x=20 + index * 20, y=50)
                for index, entity in enumerate(entities)
            }
            frames = [
                AIFrameCreate(
                    tempId=formation.id,
                    name=formation.name,
                    startTime=formation.time_ms,
                    duration=2000,
                    positions=positions,
                )
                for formation in proposal.formations
            ]
            return AIChoreoPlan(
                intent="generate_formation",
                summary=summary.summary,
                entitiesToCreate=entities,
                framesToCreate=frames,
            )

        elements = {element.id: element for element in sketch.elements}
        entities = []
        actor_source_ids = []
        for index, element_id in enumerate(mapping.actor_element_ids):
            source_id = f"model-actor-{index + 1}"
            actor_source_ids.append(source_id)
            entities.append(
                AIEntityCreate(
                    tempId=source_id,
                    type="performer",
                    name=element_id,
                    color="#3B82F6",
                )
            )
        prop_source_ids = []
        for index, element_id in enumerate(mapping.prop_element_ids):
            source_id = f"model-prop-{index + 1}"
            prop_source_ids.append(source_id)
            entities.append(
                AIEntityCreate(
                    tempId=source_id,
                    type="prop",
                    name=element_id,
                    color="#64748B",
                    shape="square",
                    propGeometryType="box",
                )
            )
        positions = {
            source_id: Position(x=elements[element_id].x, y=elements[element_id].y)
            for source_id, element_id in zip(
                actor_source_ids + prop_source_ids,
                mapping.actor_element_ids + mapping.prop_element_ids,
                strict=True,
            )
        }
        frames = [
            AIFrameCreate(
                tempId=formation.id,
                name=formation.name,
                startTime=formation.time_ms,
                duration=2000,
                positions=positions,
            )
            for formation in proposal.formations
        ]
        return AIChoreoPlan(
            intent="generate_formation",
            summary=summary.summary,
            entitiesToCreate=entities,
            framesToCreate=frames,
        )


def test_multimodal_session_interrupts_resume_and_creates_draft(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setattr(
        multimodal_choreo_graph,
        "get_multimodal_provider",
        lambda: FakeGeminiProvider(),
    )
    audio = tmp_path / "music.wav"
    sketch = tmp_path / "sketch.jpg"
    audio.write_bytes(b"fake-audio")
    sketch.write_bytes(b"fake-image")
    client = TestClient(app)
    headers = {"Authorization": "Bearer dev-member-token"}

    created = client.post(
        "/api/choreo/sessions",
        headers=headers,
        data={
            "prompt": "根据音乐和草图设计三个关键队形。",
            "segmentStartMs": "0",
            "segmentEndMs": "30000",
        },
        files={
            "audio": ("music.wav", audio.read_bytes(), "audio/wav"),
            "sketch": ("sketch.jpg", sketch.read_bytes(), "image/jpeg"),
        },
    )
    assert created.status_code == 200
    session_id = created.json()["id"]

    first = client.post(
        f"/api/choreo/sessions/{session_id}/run",
        headers=headers,
    )
    assert first.status_code == 200
    first_body = first.json()
    assert first_body["status"] == "waiting_for_user"
    assert first_body["interrupt"]["type"] == "initial_approval"
    assert len(first_body["audioAnalysis"]["formationChangeCandidates"]) >= 2
    assert first_body["sketchAnalysis"]["questions"]

    actor_ids = [
        element["id"]
        for element in first_body["sketchAnalysis"]["elements"]
        if element["shape"] in ["ellipse", "triangle"]
    ]
    prop_ids = [
        element["id"]
        for element in first_body["sketchAnalysis"]["elements"]
        if element["shape"] in ["rectangle", "square"]
    ]
    second = client.post(
        f"/api/choreo/sessions/{session_id}/resume",
        headers=headers,
        json={
            "action": "edit",
            "feedback": "按确认映射继续。",
            "mapping": {
                "actorElementIds": actor_ids,
                "propElementIds": prop_ids,
                "propDimensions": {
                    element_id: {
                        "width": 1.2 + index * 0.1,
                        "depth": 0.3,
                        "height": 2,
                    }
                    for index, element_id in enumerate(prop_ids)
                },
                "stageOrientation": "top_is_back",
            },
        },
    )
    assert second.status_code == 200
    second_body = second.json()
    assert second_body["interrupt"]["type"] == "final_approval"
    assert second_body["draft"] is None

    final = client.post(
        f"/api/choreo/sessions/{session_id}/resume",
        headers=headers,
        json={"action": "approve"},
    )
    assert final.status_code == 200
    final_body = final.json()
    assert final_body["status"] == "completed"
    assert final_body["draft"]["validation"]["valid"] is True
    assert final_body["draft"]["validation"]["frameCount"] == 3
    entities = {
        entity["tempId"]: entity
        for entity in final_body["draft"]["plan"]["entitiesToCreate"]
    }
    for index, prop_id in enumerate(prop_ids):
        assert entities[prop_id]["width"] == 1.2 + index * 0.1
        assert entities[prop_id]["depth"] == 0.3
        assert entities[prop_id]["height"] == 2
    for frame in final_body["draft"]["plan"]["framesToCreate"]:
        assert 0 <= frame["startTime"] <= 30000
        assert set(frame["positions"]) == set(actor_ids + prop_ids)

    checkpoints = client.get(
        f"/api/choreo/test-sessions/{session_id}/checkpoints",
        headers=headers,
    )
    assert checkpoints.status_code == 200
    assert len(checkpoints.json()) >= 10


@pytest.mark.parametrize(
    ("prompt", "include_audio", "include_sketch"),
    [
        ("设计一个四人逐步聚拢的三段队形。", False, False),
        ("", True, False),
        ("", False, True),
        ("根据音乐设计三个关键队形。", True, False),
    ],
    ids=["text-only", "audio-only", "image-only", "text-audio"],
)
def test_multimodal_session_accepts_flexible_input_combinations(
    monkeypatch,
    prompt,
    include_audio,
    include_sketch,
):
    monkeypatch.setattr(
        multimodal_choreo_graph,
        "get_multimodal_provider",
        lambda: FakeGeminiProvider(),
    )
    monkeypatch.setattr(
        "app.main.validate_multimodal_configuration",
        lambda: None,
    )
    files = {}
    if include_audio:
        files["audio"] = ("music.wav", b"fake-audio", "audio/wav")
    if include_sketch:
        files["sketch"] = ("sketch.jpg", b"fake-image", "image/jpeg")

    client = TestClient(app)
    headers = {"Authorization": "Bearer dev-member-token"}
    created = client.post(
        "/api/choreo/sessions",
        headers=headers,
        data={
            "prompt": prompt,
            "segmentStartMs": "0",
            "segmentEndMs": "30000",
        },
        files=files or None,
    )
    assert created.status_code == 200

    result = client.post(
        f"/api/choreo/sessions/{created.json()['id']}/run",
        headers=headers,
    )
    assert result.status_code == 200
    body = result.json()
    assert body["status"] == "waiting_for_user"
    assert body["interrupt"]["type"] == "initial_approval"
    assert (body["audioAnalysis"] is not None) is include_audio
    assert (body["sketchAnalysis"] is not None) is include_sketch
    purposes = [call["purpose"] for call in body["callLog"]]
    assert ("audio_analysis" in purposes) is include_audio
    assert ("sketch_analysis" in purposes) is include_sketch


def test_text_only_session_can_create_complete_draft(monkeypatch):
    monkeypatch.setattr(
        multimodal_choreo_graph,
        "get_multimodal_provider",
        lambda: FakeGeminiProvider(),
    )
    monkeypatch.setattr(
        "app.main.validate_multimodal_configuration",
        lambda: None,
    )
    client = TestClient(app)
    headers = {"Authorization": "Bearer dev-member-token"}
    created = client.post(
        "/api/choreo/sessions",
        headers=headers,
        data={"prompt": "创建四名演员和三个关键队形。"},
    )
    assert created.status_code == 200
    session_id = created.json()["id"]
    client.post(f"/api/choreo/sessions/{session_id}/run", headers=headers)

    summary = client.post(
        f"/api/choreo/sessions/{session_id}/resume",
        headers=headers,
        json={"action": "edit", "feedback": "保持四人编制。"},
    )
    assert summary.status_code == 200
    assert summary.json()["interrupt"]["type"] == "final_approval"

    completed = client.post(
        f"/api/choreo/sessions/{session_id}/resume",
        headers=headers,
        json={"action": "approve"},
    )
    assert completed.status_code == 200
    body = completed.json()
    assert body["status"] == "completed"
    entity_ids = {
        entity["tempId"]
        for entity in body["draft"]["plan"]["entitiesToCreate"]
    }
    assert entity_ids
    for frame in body["draft"]["plan"]["framesToCreate"]:
        assert set(frame["positions"]) == entity_ids


def test_multimodal_session_reports_missing_gemini_key(monkeypatch, tmp_path):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(
        "app.agent.gemini_multimodal.dotenv_values",
        lambda _path: {},
    )
    audio = tmp_path / "music.wav"
    sketch = tmp_path / "sketch.jpg"
    audio.write_bytes(b"fake-audio")
    sketch.write_bytes(b"fake-image")

    response = TestClient(app).post(
        "/api/choreo/sessions",
        headers={"Authorization": "Bearer dev-member-token"},
        data={
            "prompt": "设计队形",
            "segmentStartMs": "0",
            "segmentEndMs": "30000",
        },
        files={
            "audio": ("music.wav", audio.read_bytes(), "audio/wav"),
            "sketch": ("sketch.jpg", sketch.read_bytes(), "image/jpeg"),
        },
    )

    assert response.status_code == 400
    assert "GEMINI_API_KEY" in response.json()["detail"]
