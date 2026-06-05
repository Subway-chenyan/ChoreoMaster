from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_agent_access_key_validation(monkeypatch):
    monkeypatch.setenv("AGENT_ACCESS_KEYS", "admin-key-1,admin-key-2")
    monkeypatch.setenv("ALLOW_DEV_MEMBER_TOKEN", "false")
    client = TestClient(app)

    valid = client.get(
        "/api/auth/validate",
        headers={"Authorization": "Bearer admin-key-2"},
    )
    invalid = client.get(
        "/api/auth/validate",
        headers={"Authorization": "Bearer wrong-key"},
    )

    assert valid.status_code == 200
    assert valid.json() == {"valid": True}
    assert invalid.status_code == 401
    assert "Key 无效" in invalid.json()["detail"]


def test_choreo_plan_requires_member_credential():
    response = client.post(
        "/api/ai/choreo-plan",
        json={"prompt": "创建10个演员"},
    )

    assert response.status_code == 401


def test_debug_endpoint_returns_agent_steps():
    response = client.post(
        "/api/agent/choreo/debug",
        headers={"Authorization": "Bearer dev-member-token"},
        json={
            "prompt": "帮我创建10个演员，分为5组，每组一个颜色，命名分别是A/B/C/D...",
            "taskType": "initialize_project",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["plan"]["intent"] == "initialize_project"
    assert len(body["steps"]) == 6


def test_chinese_initialization_sample_over_http():
    response = client.post(
        "/api/ai/choreo-plan",
        headers={"Authorization": "Bearer dev-member-token"},
        json={
            "prompt": "帮我创建10个演员，分为5组，每组一个颜色，命名分别是A/B/C/D...，创建4个门板，高度为2m，长4m，宽0.3m",
            "taskType": "initialize_project",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["groupsToCreate"]) == 5
    assert len(body["entitiesToCreate"]) == 14
    assert body["entitiesToCreate"][0]["name"] == "A"
    assert body["entitiesToCreate"][10]["height"] == 2
    assert body["entitiesToCreate"][10]["width"] == 4
    assert body["entitiesToCreate"][10]["depth"] == 0.3
