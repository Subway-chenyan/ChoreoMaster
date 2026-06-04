from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agent import run_choreo_agent
from app.auth import require_member_credential
from app.models import AIChoreoDebugResponse, AIChoreoPlan, AIChoreoRequest

app = FastAPI(title="ChoreoMaster AI Backend")

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
