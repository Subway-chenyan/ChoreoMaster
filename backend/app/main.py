import shutil
import tempfile
import uuid
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.agent import run_choreo_agent
from app.agent.gemini_multimodal import validate_multimodal_configuration
from app.agent.multimodal_choreo_graph import (
    create_test_session,
    get_test_session,
    list_test_session_checkpoints,
    resume_test_session,
    run_test_session,
)
from app.auth import require_member_credential
from app.models import AIChoreoDebugResponse, AIChoreoPlan, AIChoreoRequest
from app.multimodal_models import (
    CheckpointInfo,
    TestSessionCreateRequest,
    TestSessionResponse,
    TestSessionResumeRequest,
)

app = FastAPI(title="CosStage AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/auth/validate")
async def validate_agent_access(
    _user_id: str = Depends(require_member_credential),
) -> dict[str, bool]:
    return {"valid": True}


@app.post("/api/ai/choreo-plan", response_model=AIChoreoPlan)
async def create_choreo_plan(
    request: AIChoreoRequest,
    _user_id: str = Depends(require_member_credential),
) -> AIChoreoPlan:
    plan, _steps = run_choreo_agent(request)
    return plan


@app.post("/api/agent/choreo/debug", response_model=AIChoreoDebugResponse)
async def debug_choreo_agent(
    request: AIChoreoRequest,
    _user_id: str = Depends(require_member_credential),
) -> AIChoreoDebugResponse:
    plan, steps = run_choreo_agent(request)
    return AIChoreoDebugResponse(plan=plan, steps=steps)


@app.post("/api/choreo/test-sessions", response_model=TestSessionResponse)
async def create_multimodal_test_session(
    request: TestSessionCreateRequest,
    _user_id: str = Depends(require_member_credential),
) -> TestSessionResponse:
    session_id = create_test_session(request)
    return get_test_session(session_id)


async def _save_upload(upload: UploadFile, directory: Path, fallback: str) -> str:
    suffix = Path(upload.filename or "").suffix or fallback
    target = directory / f"{uuid.uuid4().hex}{suffix}"
    with target.open("wb") as output:
        shutil.copyfileobj(upload.file, output)
    await upload.close()
    return str(target)


@app.post("/api/choreo/sessions", response_model=TestSessionResponse)
async def create_multimodal_session(
    prompt: str = Form(default=""),
    segment_start_ms: int = Form(default=0, alias="segmentStartMs"),
    segment_end_ms: int = Form(default=30000, alias="segmentEndMs"),
    audio: UploadFile | None = File(default=None),
    sketch: UploadFile | None = File(default=None),
    _user_id: str = Depends(require_member_credential),
) -> TestSessionResponse:
    try:
        validate_multimodal_configuration()
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if not prompt.strip() and audio is None and sketch is None:
        raise HTTPException(status_code=400, detail="文本、音频、图片至少提供一种。")
    if audio and (not audio.content_type or not audio.content_type.startswith("audio/")):
        raise HTTPException(status_code=400, detail="请选择有效的音频文件。")
    if sketch and (not sketch.content_type or not sketch.content_type.startswith("image/")):
        raise HTTPException(status_code=400, detail="请选择有效的图片文件。")
    if audio and segment_end_ms <= segment_start_ms:
        raise HTTPException(status_code=400, detail="结束时间必须晚于开始时间。")

    upload_dir = (
        Path(tempfile.gettempdir())
        / "cosstage-agent-uploads"
        / uuid.uuid4().hex
    )
    upload_dir.mkdir(parents=True, exist_ok=True)
    try:
        audio_path = await _save_upload(audio, upload_dir, ".audio") if audio else None
        sketch_path = await _save_upload(sketch, upload_dir, ".jpg") if sketch else None
        request = TestSessionCreateRequest(
            audioPath=audio_path,
            sketchPath=sketch_path,
            segmentStartMs=segment_start_ms,
            segmentEndMs=segment_end_ms,
            userRequirements=prompt,
        )
        session_id = create_test_session(request)
        return get_test_session(session_id)
    except Exception:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise


@app.post(
    "/api/choreo/test-sessions/{session_id}/run",
    response_model=TestSessionResponse,
)
async def run_multimodal_test_session(
    session_id: str,
    _user_id: str = Depends(require_member_credential),
) -> TestSessionResponse:
    try:
        await run_in_threadpool(run_test_session, session_id)
        return get_test_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found.")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post(
    "/api/choreo/test-sessions/{session_id}/resume",
    response_model=TestSessionResponse,
)
async def resume_multimodal_test_session(
    session_id: str,
    request: TestSessionResumeRequest,
    _user_id: str = Depends(require_member_credential),
) -> TestSessionResponse:
    try:
        await run_in_threadpool(resume_test_session, session_id, request)
        return get_test_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found.")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post(
    "/api/choreo/sessions/{session_id}/run",
    response_model=TestSessionResponse,
)
async def run_multimodal_session(
    session_id: str,
    _user_id: str = Depends(require_member_credential),
) -> TestSessionResponse:
    return await run_multimodal_test_session(session_id, _user_id)


@app.post(
    "/api/choreo/sessions/{session_id}/resume",
    response_model=TestSessionResponse,
)
async def resume_multimodal_session(
    session_id: str,
    request: TestSessionResumeRequest,
    _user_id: str = Depends(require_member_credential),
) -> TestSessionResponse:
    return await resume_multimodal_test_session(session_id, request, _user_id)


@app.get(
    "/api/choreo/sessions/{session_id}",
    response_model=TestSessionResponse,
)
async def read_multimodal_session(
    session_id: str,
    _user_id: str = Depends(require_member_credential),
) -> TestSessionResponse:
    return await read_multimodal_test_session(session_id, _user_id)


@app.get(
    "/api/choreo/test-sessions/{session_id}",
    response_model=TestSessionResponse,
)
async def read_multimodal_test_session(
    session_id: str,
    _user_id: str = Depends(require_member_credential),
) -> TestSessionResponse:
    try:
        return get_test_session(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found.")


@app.get(
    "/api/choreo/test-sessions/{session_id}/checkpoints",
    response_model=list[CheckpointInfo],
)
async def read_multimodal_test_checkpoints(
    session_id: str,
    _user_id: str = Depends(require_member_credential),
) -> list[CheckpointInfo]:
    try:
        return list_test_session_checkpoints(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found.")
