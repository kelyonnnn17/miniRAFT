# Submission Deliverables

This document maps the required submission artifacts to the current repository and includes a demo script.

## A. Source Code Repository

Required structure from assignment:
- gateway
- replica1, replica2, replica3
- frontend
- docker-compose.yml
- failover logs

Current implementation mapping:
- Gateway service code: `services/gateway`
- Frontend service code: `services/frontend`
- Shared contracts/logger: `shared`
- Replica base implementation: `services/replica`
- Replica-specific bind-mounted folders for hot reload:
  - `replica1/src`
  - `replica2/src`
  - `replica3/src`
- Compose orchestration: `docker-compose.yml`
- Example log evidence: `logs/failover.example.log`

Notes:
- Replica containers use distinct source bind mounts in `docker-compose.yml`.
- State persistence uses per-replica Docker volumes (`replica1-data`, `replica2-data`, `replica3-data`).

## B. Architecture Document (2-3 pages)

Included docs:
- `docs/architecture.md`
- `docs/testing.md`

Coverage checklist:
- Cluster diagram: present in `docs/architecture.md`
- RAFT-lite protocol design: present in `docs/architecture.md`
- State transitions: present in `docs/architecture.md`
- API definitions: present in `docs/architecture.md`
- Failure-handling design: present in `docs/architecture.md` + `docs/testing.md`

## C. Demonstration Video (8-10 minutes)

### Recommended recording script

1. System bring-up (1 minute)
- Run: `docker compose up --build`
- Open UI at `http://localhost:3000`
- Show 3 replica status endpoints and gateway status endpoint.

2. Multi-client drawing (2 minutes)
- Open at least two tabs/windows.
- Draw from both tabs simultaneously.
- Show that committed strokes appear consistently in both tabs.

3. Leader failure and automatic failover (2 minutes)
- Identify current leader via replica `/status`.
- Kill leader container (`docker compose kill replicaX`).
- Continue drawing while election happens.
- Show new leader appears and drawing remains available.

4. Hot reload / replacement behavior (2 minutes)
- Edit a file in one of:
  - `replica1/src`
  - `replica2/src`
  - `replica3/src`
- Show corresponding container restarts via logs.
- Demonstrate clients stay connected and cluster continues operation.

5. Restarted node catch-up and convergence (1-2 minutes)
- Restart a replica with empty state.
- Show catch-up through `/sync-log` behavior in logs.
- Confirm converged committed log across all replicas.

## Quick Verification Commands

- Integration tests:
  - `npm run test:integration`

- Follow logs during demo:
  - `docker compose logs -f gateway replica1 replica2 replica3`

- Health and status checks:
  - `http://localhost:8080/health`
  - `http://localhost:8080/status`
  - `http://localhost:5001/status`
  - `http://localhost:5002/status`
  - `http://localhost:5003/status`

## Evidence to Include in Submission

- Screenshots or snippets showing:
  - Leader election (`election_started`, `became_leader`)
  - Leader step-down on higher term (`step_down`)
  - Commit events (`entry_committed`)
  - Catch-up events (`catchup_applied`)
- Video timestamp callouts for each required scenario.
