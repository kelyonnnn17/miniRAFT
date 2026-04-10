# Testing Guide

## Automated Integration Test

Run:

```bash
npm run test:integration
```

The integration scenario validates:

1. Initial leader election in a 3-replica cluster.
2. Quorum commit behavior for client strokes.
3. Follower wipe + restart and catch-up via `sync-log`.
4. Leader failure and successful re-election.
5. Gateway WebSocket path delivering committed stroke broadcasts after failover.
6. Cluster convergence after old leader restart.

## Manual Chaos Checklist

1. Start stack with `docker compose up --build`.
2. Open multiple tabs at `http://localhost:3000` and draw simultaneously.
3. Kill current leader container and verify drawing continues.
4. Restart killed leader and confirm state converges.
5. Restart a follower with cleared state and verify catch-up.
6. Repeat with rapid restart sequence of two replicas (not all at once).

## Useful Endpoints

- Replica status: `GET /status`
- Replica health: `GET /health`
- Replica committed log: `GET /client/committed-log`
- Gateway status: `GET /status`
- Gateway health: `GET /health`
