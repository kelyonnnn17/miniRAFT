# miniRAFT

Distributed real-time drawing board with a Mini-RAFT consensus cluster.

## Current Implementation Status

- 3 replica services with RAFT-lite leader election and log replication
- Gateway service with WebSocket client fanout and leader forwarding
- Frontend canvas client rendering snapshots and committed strokes
- Docker Compose setup for 1 gateway + 3 replicas + 1 frontend
- Follower catch-up path using `/sync-log` on restart or log mismatch
- Integration test covering election, failover, catch-up, and gateway broadcast

## Project Structure

- `services/replica`: RAFT-like replica node (Follower/Candidate/Leader)
- `services/gateway`: WebSocket gateway routing client strokes to leader
- `services/frontend`: Static canvas app served by Express
- `shared`: Shared contracts and structured logging helper

## Local Run

1. Install dependencies:

```bash
npm install
```

2. Run all services with Docker Compose:

```bash
docker compose up --build
```

3. Open frontend:

```text
http://localhost:3000
```

4. Replica status endpoints:

- `http://localhost:5001/status`
- `http://localhost:5002/status`
- `http://localhost:5003/status`

5. Gateway status:

- `http://localhost:8080/status`

## Automated Verification

Run integration tests:

```bash
npm run test:integration
```

This test spins up an isolated local cluster and validates leader election, follower reset catch-up,
leader failover, gateway stroke broadcast, and convergence after restart.

## Key Environment Variables

- Replica:
	- `PORT`
	- `NODE_ID`
	- `PEERS`
	- `DATA_DIR`
	- `ELECTION_MIN_MS` (default `500`)
	- `ELECTION_MAX_MS` (default `800`)
	- `HEARTBEAT_MS` (default `150`)
- Gateway:
	- `PORT`
	- `REPLICAS`

## Notes

- The leader commits a stroke after quorum acknowledgment.
- Gateway broadcasts only committed entries.
- Replica state is persisted to Docker volumes (`/data/state.json`).
- `/sync-log` endpoint is used by followers for restarted-node catch-up.

## Documentation

- `docs/architecture.md`
- `docs/testing.md`
