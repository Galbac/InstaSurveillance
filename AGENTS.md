# Project guidance

This repository is currently a small Python project. Inspect existing code before choosing a web stack and keep changes aligned with its architecture.

## Dependency freshness

- Before adding or upgrading a dependency, check its current stable release and supported Python versions in official documentation or the package index.
- Prefer stable releases. Keep Poetry's `pyproject.toml` and `poetry.lock` consistent; check direct/transitive compatibility, runtime support, maintenance status, and security advisories.
- Make the smallest necessary dependency change. Do not upgrade unrelated packages just to make version numbers newer.
- Explain chosen versions and compatibility caveats. If live lookup is unavailable, do not claim a version is latest.

## Engineering quality

- Use type hints, clear boundaries, environment-based configuration, structured logging, and explicit error handling.
- For APIs, validate input at the boundary, keep secrets server-side, use migrations for schema changes, and avoid blocking I/O in async paths.
- For UI work, build responsive, accessible interfaces and verify in a browser when browser tooling is available.
- Treat security, privacy, authentication, authorization, and data retention as product requirements.
- Follow project instructions about tests. Do not claim checks ran unless they did.
