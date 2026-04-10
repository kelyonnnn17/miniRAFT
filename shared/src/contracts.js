export const NodeState = {
  FOLLOWER: "Follower",
  CANDIDATE: "Candidate",
  LEADER: "Leader",
};

export const RpcPaths = {
  REQUEST_VOTE: "/request-vote",
  APPEND_ENTRIES: "/append-entries",
  HEARTBEAT: "/heartbeat",
  SYNC_LOG: "/sync-log",
  STATUS: "/status",
};

export function nowIso() {
  return new Date().toISOString();
}
