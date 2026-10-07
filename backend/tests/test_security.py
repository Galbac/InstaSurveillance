import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.db import get_db
from app.core.dependencies import authenticate, current_user
from app.core.security import hasher
from app.main import app
from app.models import AuthToken, Base, Profile, User
from app.modules import auth


@pytest.fixture
def client_db(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    session = Session(engine)
    app.dependency_overrides[get_db] = lambda: session

    from fastapi import Request

    def test_user(request: Request):
        return authenticate(request, session)

    app.dependency_overrides[current_user] = test_user
    monkeypatch.setattr(auth, "rate_limit", lambda *args: None)
    with TestClient(app) as client:
        yield client, session
    app.dependency_overrides.clear()
    session.close()
    engine.dispose()


def csrf_header(client):
    return {"X-CSRF-Token": client.get("/api/v1/auth/csrf").json()["csrf_token"]}


def login(client, session, email="owner@example.com"):
    user = User(email=email, password_hash=hasher.hash("test-password-long"), verified=True)
    session.add(user)
    session.commit()
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "test-password-long"},
        headers=csrf_header(client),
    )
    assert response.status_code == 200
    return user


def test_mutation_requires_csrf(client_db):
    client, _ = client_db
    r = client.post(
        "/api/v1/auth/register",
        json={"email": "x@example.com", "password": "private-secret", "accepted_terms": True},
    )
    assert r.status_code == 403


def test_validation_does_not_echo_secrets(client_db):
    client, _ = client_db
    r = client.post(
        "/api/v1/auth/login", json={"email": "invalid", "password": "TOP-SECRET"}, headers=csrf_header(client)
    )
    assert r.status_code == 422
    assert "TOP-SECRET" not in r.text


def test_foreign_profile_is_not_found(client_db):
    client, session = client_db
    owner = login(client, session)
    other = User(email="other@example.com", password_hash="unused", verified=True)
    session.add(other)
    session.flush()
    profile = Profile(user_id=other.id, username="other")
    session.add(profile)
    session.commit()
    r = client.get("/api/v1/profiles/" + profile.id + "/summary")
    assert r.status_code == 404
    assert owner.id != other.id


def test_session_logout_revokes_access(client_db):
    client, session = client_db
    login(client, session)
    assert client.get("/api/v1/me").status_code == 200
    r = client.post("/api/v1/auth/logout", headers=csrf_header(client))
    assert r.status_code == 204
    assert client.get("/api/v1/me").status_code == 401


def test_origin_guard_blocks_cross_site(client_db):
    client, session = client_db
    login(client, session)
    r = client.post("/api/v1/auth/logout", headers={**csrf_header(client), "Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.get("/api/v1/me").status_code == 200


def test_reset_token_is_single_use(client_db):
    client, session = client_db
    user = login(client, session)
    from datetime import timedelta

    from app.core.security import digest, now

    raw = "a" * 40
    session.add(
        AuthToken(
            user_id=user.id, token_hash=digest(raw), purpose="reset", expires_at=now() + timedelta(minutes=10)
        )
    )
    session.commit()
    body = {"token": raw, "password": "new-password-long"}
    r = client.post("/api/v1/auth/reset-password", json=body, headers=csrf_header(client))
    assert r.status_code == 204
    r = client.post("/api/v1/auth/reset-password", json=body, headers=csrf_header(client))
    assert r.status_code == 400
    assert client.get("/api/v1/me").status_code == 401
    assert session.scalar(select(AuthToken)) is None
