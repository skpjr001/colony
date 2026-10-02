import wasmModule from "../vendor/colony-core/colony_core_wasm_bg.wasm";
import { initSync } from "../vendor/colony-core/colony_core_wasm.js";

initSync(wasmModule);

export {
  churnFrozen,
  claimAlive,
  claimStrength,
  coreVersion,
  evaluateQuorum,
  isBroad,
  pingPong,
  pickTask,
  scoreAttempt,
  shardForPath,
  shardsForPaths,
  slotsFor,
  tierFor,
  trustScore,
} from "../vendor/colony-core/colony_core_wasm.js";
