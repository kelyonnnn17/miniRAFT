import { NodeState, RpcPaths } from "@miniraft/shared/src/contracts.js";
import { logEvent } from "@miniraft/shared/src/logger.js";
import { loadState, saveState } from "./storage.js";

const ELECTION_MIN_MS = Number(process.env.ELECTION_MIN_MS || 500);
const ELECTION_MAX_MS = Number(process.env.ELECTION_MAX_MS || 800);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 150);

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export class RaftNode {
  constructor({ nodeId, peers, dataDir, advertiseAddress }) {
    this.nodeId = nodeId;
    this.peers = peers;
    this.dataDir = dataDir;
    this.advertiseAddress = advertiseAddress;

    const persisted = loadState(this.dataDir);
    this.currentTerm = persisted.currentTerm;
    this.votedFor = persisted.votedFor;
    this.log = persisted.log;
    this.commitIndex = persisted.commitIndex;
    for (let i = 0; i <= this.commitIndex && i < this.log.length; i += 1) {
      this.log[i].committed = true;
    }

    this.state = NodeState.FOLLOWER;
    this.leaderId = null;
    this.leaderAddress = null;

    this.electionTimer = null;
    this.heartbeatTimer = null;
    this.nextIndex = {};
    this.matchIndex = {};
    this.catchUpInFlight = false;
    this.resetElectionTimer();
  }

  status() {
    return {
      nodeId: this.nodeId,
      state: this.state,
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      leaderId: this.leaderId,
      leaderAddress: this.leaderAddress,
      advertiseAddress: this.advertiseAddress,
      commitIndex: this.commitIndex,
      logLength: this.log.length,
    };
  }

  persist() {
    saveState(this.dataDir, {
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      log: this.log,
      commitIndex: this.commitIndex,
    });
  }

  logInfo(eventType, extra = {}) {
    logEvent({
      service: "replica",
      nodeId: this.nodeId,
      term: this.currentTerm,
      state: this.state,
      commitIndex: this.commitIndex,
      eventType,
      ...extra,
    });
  }

  resetElectionTimer() {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
    }

    const timeout = randBetween(ELECTION_MIN_MS, ELECTION_MAX_MS);
    this.electionTimer = setTimeout(() => {
      if (this.state !== NodeState.LEADER) {
        this.startElection().catch((err) => {
          this.logInfo("election_error", { message: err.message });
        });
      }
    }, timeout);
  }

  stepDown(term, leaderId = null) {
    this.state = NodeState.FOLLOWER;
    this.currentTerm = term;
    this.votedFor = null;
    this.leaderId = leaderId;
    this.leaderAddress = null;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.persist();
    this.resetElectionTimer();
    this.logInfo("step_down", { leaderId });
  }

  async startElection() {
    this.state = NodeState.CANDIDATE;
    this.currentTerm += 1;
    this.votedFor = this.nodeId;
    this.leaderId = null;
    this.persist();

    let votes = 1;
    const majority = Math.floor((this.peers.length + 1) / 2) + 1;
    this.logInfo("election_started", { majority });

    const payload = {
      term: this.currentTerm,
      candidateId: this.nodeId,
      lastLogIndex: this.log.length - 1,
      lastLogTerm: this.log.length > 0 ? this.log[this.log.length - 1].term : 0,
    };

    const responses = await Promise.all(
      this.peers.map(async (peer) => {
        try {
          const res = await fetch(`http://${peer}${RpcPaths.REQUEST_VOTE}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          return await res.json();
        } catch {
          return null;
        }
      }),
    );

    for (const response of responses) {
      if (!response) continue;
      if (response.term > this.currentTerm) {
        this.stepDown(response.term);
        return;
      }
      if (response.voteGranted) {
        votes += 1;
      }
    }

    if (votes >= majority && this.state === NodeState.CANDIDATE) {
      this.becomeLeader();
      return;
    }

    this.resetElectionTimer();
    this.logInfo("election_lost", { votes, majority });
  }

  becomeLeader() {
    this.state = NodeState.LEADER;
    this.leaderId = this.nodeId;
    this.leaderAddress = this.advertiseAddress;
    this.peers.forEach((peer) => {
      this.nextIndex[peer] = this.log.length;
      this.matchIndex[peer] = -1;
    });

    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }

    this.logInfo("became_leader");
    this.sendHeartbeats();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeats();
    }, HEARTBEAT_MS);
  }

  async sendHeartbeats() {
    if (this.state !== NodeState.LEADER) {
      return;
    }

    const payload = {
      term: this.currentTerm,
      leaderId: this.nodeId,
      leaderAddress: this.advertiseAddress,
      prevLogIndex: this.log.length - 1,
      prevLogTerm: this.log.length > 0 ? this.log[this.log.length - 1].term : 0,
      entries: [],
      leaderCommit: this.commitIndex,
    };

    await Promise.all(
      this.peers.map(async (peer) => {
        try {
          const res = await fetch(`http://${peer}${RpcPaths.HEARTBEAT}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          const response = await res.json();
          if (response.term > this.currentTerm) {
            this.stepDown(response.term, response.leaderId || null);
          }
        } catch {
          // Intentionally ignored; unreachable followers can recover with sync-log.
        }
      }),
    );
  }

  handleRequestVote(req) {
    const { term, candidateId, lastLogIndex, lastLogTerm } = req;

    if (term < this.currentTerm) {
      return { term: this.currentTerm, voteGranted: false };
    }

    if (term > this.currentTerm) {
      this.stepDown(term);
    }

    const localLastIndex = this.log.length - 1;
    const localLastTerm = localLastIndex >= 0 ? this.log[localLastIndex].term : 0;
    const candidateUpToDate =
      lastLogTerm > localLastTerm ||
      (lastLogTerm === localLastTerm && lastLogIndex >= localLastIndex);

    if ((this.votedFor === null || this.votedFor === candidateId) && candidateUpToDate) {
      this.votedFor = candidateId;
      this.persist();
      this.resetElectionTimer();
      this.logInfo("vote_granted", { candidateId });
      return { term: this.currentTerm, voteGranted: true };
    }

    return { term: this.currentTerm, voteGranted: false };
  }

  handleAppendEntries(req) {
    const { term, leaderId, leaderAddress, prevLogIndex, prevLogTerm, entries, leaderCommit } = req;

    if (term < this.currentTerm) {
      return { term: this.currentTerm, success: false, matchIndex: this.log.length - 1 };
    }

    if (term >= this.currentTerm) {
      if (this.state !== NodeState.FOLLOWER || this.leaderId !== leaderId) {
        this.stepDown(term, leaderId);
      }
      this.currentTerm = term;
      this.leaderId = leaderId;
      this.leaderAddress = leaderAddress || this.leaderAddress;
      this.resetElectionTimer();
    }

    if (prevLogIndex >= 0) {
      if (prevLogIndex >= this.log.length) {
        this.requestCatchUpFromLeader();
        return { term: this.currentTerm, success: false, matchIndex: this.log.length - 1 };
      }
      if (this.log[prevLogIndex].term !== prevLogTerm) {
        this.log = this.log.slice(0, prevLogIndex);
        this.persist();
        this.requestCatchUpFromLeader();
        return { term: this.currentTerm, success: false, matchIndex: this.log.length - 1 };
      }
    }

    if (entries.length > 0) {
      const start = prevLogIndex + 1;
      this.log = this.log.slice(0, start).concat(entries);
      this.persist();
      this.logInfo("entries_appended", { count: entries.length });
    }

    if (leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(leaderCommit, this.log.length - 1);
      for (let i = 0; i <= this.commitIndex && i < this.log.length; i += 1) {
        this.log[i].committed = true;
      }
      this.persist();
    }

    return {
      term: this.currentTerm,
      success: true,
      matchIndex: this.log.length - 1,
    };
  }

  async appendClientStroke(stroke) {
    return this.appendClientOperation(stroke);
  }

  async appendClientOperation(operation) {
    if (this.state !== NodeState.LEADER) {
      return { ok: false, reason: "not_leader", leaderId: this.leaderId };
    }

    const entry = {
      index: this.log.length,
      term: this.currentTerm,
      operation,
      committed: false,
    };

    this.log.push(entry);
    this.persist();

    let acks = 1;
    const majority = Math.floor((this.peers.length + 1) / 2) + 1;

    await Promise.all(
      this.peers.map(async (peer) => {
        const replicated = await this.replicateToPeer(peer);
        if (replicated) {
          acks += 1;
        }
      }),
    );

    if (acks >= majority) {
      entry.committed = true;
      this.commitIndex = entry.index;
      this.persist();
      this.logInfo("entry_committed", { index: entry.index });
      this.sendHeartbeats();
      return { ok: true, entry };
    }

    return { ok: false, reason: "quorum_not_reached" };
  }

  async replicateToPeer(peer) {
    let attempts = 0;
    while (attempts < 5 && this.state === NodeState.LEADER) {
      attempts += 1;
      const nextIndex = this.nextIndex[peer] ?? this.log.length;
      const prevLogIndex = nextIndex - 1;
      const prevLogTerm = prevLogIndex >= 0 ? this.log[prevLogIndex]?.term ?? 0 : 0;
      const entries = this.log.slice(nextIndex);

      try {
        const res = await fetch(`http://${peer}${RpcPaths.APPEND_ENTRIES}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            term: this.currentTerm,
            leaderId: this.nodeId,
            leaderAddress: this.advertiseAddress,
            prevLogIndex,
            prevLogTerm,
            entries,
            leaderCommit: this.commitIndex,
          }),
        });

        const response = await res.json();
        if (response.term > this.currentTerm) {
          this.stepDown(response.term);
          return false;
        }

        if (response.success) {
          this.matchIndex[peer] = response.matchIndex;
          this.nextIndex[peer] = response.matchIndex + 1;
          return true;
        }

        this.nextIndex[peer] = Math.max(0, nextIndex - 1);
      } catch {
        return false;
      }
    }

    return false;
  }

  requestCatchUpFromLeader() {
    if (this.catchUpInFlight || !this.leaderAddress || this.state !== NodeState.FOLLOWER) {
      return;
    }

    this.catchUpInFlight = true;
    const fromIndex = this.log.length;
    fetch(`http://${this.leaderAddress}${RpcPaths.SYNC_LOG}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromIndex }),
    })
      .then(async (res) => res.json())
      .then((response) => {
        if (response.term > this.currentTerm) {
          this.stepDown(response.term, this.leaderId);
          return;
        }

        const entries = Array.isArray(response.entries) ? response.entries : [];
        if (entries.length > 0) {
          this.log = this.log.slice(0, fromIndex).concat(entries);
        }

        if (typeof response.commitIndex === "number") {
          this.commitIndex = Math.max(this.commitIndex, response.commitIndex);
        }

        this.persist();
        this.logInfo("catchup_applied", { fromIndex, received: entries.length });
      })
      .catch(() => {
        // Catch-up is best effort; heartbeat/append cycles will retry.
      })
      .finally(() => {
        this.catchUpInFlight = false;
      });
  }

  handleSyncLog(req) {
    const { fromIndex } = req;
    return {
      term: this.currentTerm,
      entries: this.log.slice(fromIndex).filter((entry) => entry.committed),
      commitIndex: this.commitIndex,
    };
  }
}
