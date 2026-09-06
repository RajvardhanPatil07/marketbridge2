import json

from fastapi.testclient import TestClient

from marketbridge.api import app

client = TestClient(app)


def test_catalog_and_all_traces_are_finite_and_deterministic():
    response = client.get("/v1/demo/scenarios")
    assert response.status_code == 200
    catalog = response.json()
    assert catalog["data_mode"] == "SYNTHETIC_TEST"
    assert len(catalog["scenarios"]) == 6
    for scenario in catalog["scenarios"]:
        for symbol in ["NVDA", "TSLA"]:
            url = f"/v1/demo/scenarios/{scenario['id']}?symbol={symbol}"
            trace = client.get(url)
            assert trace.status_code == 200
            data = trace.json()
            assert len(data["steps"]) == 61
            assert data["symbol"] == symbol
            assert data["data_mode"] == "SYNTHETIC_TEST"
            json.dumps(data, allow_nan=False)
            assert client.get(url).json() == data


def test_bad_inputs_and_mutations_are_rejected():
    assert client.get("/v1/demo/scenarios/no-such-scenario").status_code == 404
    assert client.get("/v1/demo/scenarios/normal?symbol=BTC").status_code == 404
    assert client.post("/v1/demo/scenarios/normal").status_code == 405
    assert client.get("/v1/missing").status_code == 404
    assert client.get("/.env").status_code == 404
    assert client.get("/%2e%2e/pyproject.toml").status_code == 404


def test_synthetic_evaluation_is_explicit_and_passes():
    response = client.get("/v1/demo/evaluation")
    assert response.status_code == 200
    result = response.json()
    assert result["evaluation_kind"] == "synthetic_functional_tests"
    assert result["summary"]["failed"] == 0
    assert len(result["cases"]) == 12
    assert result["limitations"]


def test_response_security_and_health():
    response = client.get("/health")
    assert response.json()["status"] == "ok"
    assert response.headers["x-content-type-options"] == "nosniff"
    response = client.get("/v1/demo/scenarios")
    assert response.headers["cache-control"] == "no-store"

