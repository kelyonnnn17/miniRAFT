# MiniRAFT Architecture

## Services

1. Replica service (`services/replica`)
- Maintains RAFT-lite state (`Follower`, `Candidate`, `Leader`).
- Persists `currentTerm`, `votedFor`, append-only log, and `commitIndex`.
- Exposes RPC-like HTTP endpoints:
  - `POST /request-vote`
  - `POST /append-entries`
  - `POST /heartbeat`
  - `POST /sync-log`
- Exposes client helpers:
  - `POST /client/stroke` (leader only)
  - `GET /client/committed-log`

2. Gateway service (`services/gateway`)
- Accepts WebSocket clients.
- Forwards incoming stroke events to current leader.
- Broadcasts only committed entries to all clients.
- Re-discovers leader during elections/failover.

3. Frontend service (`services/frontend`)
- Canvas UI that sends stroke events over WebSocket.
- Applies initial snapshot then live committed updates.

## Consensus Rules Implemented

1. Election timeout randomized (`ELECTION_MIN_MS`..`ELECTION_MAX_MS`).
2. Heartbeat interval (`HEARTBEAT_MS`) from leader to followers.
3. Leader election by majority quorum in 3-node cluster.
4. Log append and majority acknowledgment before commit.
5. Step-down on higher term observation.
6. Restarted follower catch-up through `sync-log` path.

## Restart Catch-Up Flow

1. Follower receives AppendEntries/Heartbeat with `prevLogIndex` it cannot satisfy.
2. Follower triggers asynchronous `POST /sync-log` call to the current leader address.
3. Leader returns committed entries from follower's `fromIndex`.
4. Follower appends missing committed entries and advances `commitIndex`.
5. Normal heartbeat/append resumes.

## Deployment

`docker-compose.yml` starts:
- 3 replicas with unique `NODE_ID` and `ADVERTISE_ADDR`
- 1 gateway
- 1 frontend

Each replica uses a dedicated Docker volume for persisted state.

## Observability

Structured JSON logs include:
- `service`
- `nodeId`
- `term`
- `state`
- `commitIndex`
- `eventType`
