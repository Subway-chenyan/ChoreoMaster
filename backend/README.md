# ChoreoMaster AI Backend

Python + FastAPI + LangGraph backend for the intelligent formation module.

## Run locally

```bash
cd backend
python -m pip install -r requirements.txt
cd ..
npm run dev:backend
```

## Test

```bash
npm run test:backend
```

## Optional model gateway

The LangGraph workflow can call your membership-backed model service before it
falls back to the deterministic rule engine. Configure it with:

```bash
set CHOREO_AGENT_MODEL_URL=https://your-gateway.example.com/choreo-plan
set CHOREO_AGENT_MODEL_TOKEN=your-service-token
```

The gateway should return either an `AIChoreoPlan` object directly or
`{"plan": AIChoreoPlan}`.

## API

- `POST /api/ai/choreo-plan`
  - Production-facing endpoint for the Web and Electron clients.
  - Requires `Authorization: Bearer <member-token>`.
- `POST /api/agent/choreo/debug`
  - Agent debug endpoint.
  - Returns every LangGraph node step plus the final `AIChoreoPlan`.

The current implementation includes a deterministic rule-based fallback so the
API and tests can run even when the real model gateway is not configured.
