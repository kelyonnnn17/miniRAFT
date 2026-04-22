import fs from "node:fs";
import path from "node:path";

const DEFAULT_STATE = {
  currentTerm: 0,
  votedFor: null,
  log: [],
  commitIndex: -1,
};

export function loadState(dataDir) {
  const filePath = path.join(dataDir, "state.json");
  fs.mkdirSync(dataDir, { recursive: true });

  if (process.env.RESET_STATE_ON_START === "1") {
    fs.writeFileSync(filePath, JSON.stringify(DEFAULT_STATE, null, 2));
    return structuredClone(DEFAULT_STATE);
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(DEFAULT_STATE, null, 2));
    return structuredClone(DEFAULT_STATE);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  return {
    ...DEFAULT_STATE,
    ...parsed,
  };
}

export function saveState(dataDir, state) {
  const filePath = path.join(dataDir, "state.json");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}
