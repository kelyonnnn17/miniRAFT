import { nowIso } from "./contracts.js";

export function logEvent(fields) {
  const payload = {
    at: nowIso(),
    ...fields,
  };
  console.log(JSON.stringify(payload));
}
