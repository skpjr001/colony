use colony_core::{
    churn_frozen, evaluate_quorum, is_alive, is_broad, pick_task, ping_pong, score_attempt,
    shards_for_glob, strength, take_probability, tier_for, trust_score, AgentProfile, Budget, Claim,
    ClaimCfg, Evidence, QuorumCfg, ReviewVote, Role, ShardMap, Task, TaskState, TrustTier,
    Uncertainty, Verdict,
};
use wasm_bindgen::prelude::*;

fn demo_map() -> ShardMap {
    ShardMap::new(
        true,
        1,
        "root",
        &["src/*".into(), "crates/*".into(), "docs".into()],
    )
    .expect("demo shard map")
}

fn known() -> Vec<String> {
    [
        "src/payments",
        "src/api",
        "src/auth",
        "crates/colony-core",
        "crates/colony-api",
        "docs",
        "root",
        "src",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

#[wasm_bindgen(js_name = coreVersion)]
pub fn core_version() -> String {
    "colony-core-wasm".into()
}

#[wasm_bindgen(js_name = shardForPath)]
pub fn shard_for_path(path: &str) -> String {
    demo_map().shard_for_path(path)
}

#[wasm_bindgen(js_name = shardsForPaths)]
pub fn shards_for_paths(paths_json: &str) -> String {
    let paths: Vec<String> = serde_json::from_str(paths_json).unwrap_or_default();
    let map = demo_map();
    let known = known();
    let mut out = Vec::new();
    for path in paths {
        for shard in shards_for_glob(&map, &path, &known) {
            if !out.contains(&shard) {
                out.push(shard);
            }
        }
    }
    serde_json::to_string(&out).unwrap_or_else(|_| "[]".into())
}

#[wasm_bindgen(js_name = isBroad)]
pub fn is_broad_claim(shards_json: &str, max_fanout: u32) -> bool {
    let shards: Vec<String> = serde_json::from_str(shards_json).unwrap_or_default();
    is_broad(&shards, max_fanout as usize)
}

#[wasm_bindgen(js_name = claimStrength)]
pub fn claim_strength(strength0: f32, last_heartbeat_ms: f64, now_ms: f64) -> f32 {
    let claim = Claim {
        id: String::new(),
        agent_id: String::new(),
        task_id: String::new(),
        paths: vec![],
        shards: vec![],
        shard_map_version: 1,
        intent: String::new(),
        strength0,
        last_heartbeat_ms: last_heartbeat_ms as u64,
        ttl_ms: ClaimCfg::default().ttl_ms,
    };
    strength(&claim, now_ms as u64, ClaimCfg::default().lambda_per_min)
}

#[wasm_bindgen(js_name = claimAlive)]
pub fn claim_alive(strength0: f32, last_heartbeat_ms: f64, ttl_ms: f64, now_ms: f64) -> bool {
    let claim = Claim {
        id: String::new(),
        agent_id: String::new(),
        task_id: String::new(),
        paths: vec![],
        shards: vec![],
        shard_map_version: 1,
        intent: String::new(),
        strength0,
        last_heartbeat_ms: last_heartbeat_ms as u64,
        ttl_ms: ttl_ms as u64,
    };
    is_alive(&claim, now_ms as u64, &ClaimCfg::default())
}

#[wasm_bindgen(js_name = scoreAttempt)]
pub fn score_attempt_json(evidence_json: &str) -> f32 {
    let ev: Evidence = match serde_json::from_str(evidence_json) {
        Ok(ev) => ev,
        Err(_) => return -1.0,
    };
    score_attempt(&ev, 0.5).unwrap_or(-1.0)
}

#[wasm_bindgen(js_name = evaluateQuorum)]
pub fn evaluate_quorum_json(author_id: &str, author_family: &str, votes_json: &str, security_tagged: bool) -> String {
    let raw: Vec<VoteIn> = serde_json::from_str(votes_json).unwrap_or_default();
    let votes: Vec<ReviewVote> = raw
        .into_iter()
        .filter_map(|vote| {
            let verdict = match vote.verdict.to_ascii_lowercase().as_str() {
                v if v.contains("approve") => Verdict::Approve,
                v if v.contains("reject") => Verdict::Reject,
                _ => return None,
            };
            Some(ReviewVote {
                reviewer_id: vote.reviewer_id,
                model_family: vote.model_family,
                verdict,
                score: vote.score,
            })
        })
        .collect();
    match evaluate_quorum(author_id, author_family, &votes, security_tagged, false, &QuorumCfg::default()) {
        colony_core::QuorumResult::Approved => "Approved".into(),
        colony_core::QuorumResult::Rejected => "Rejected".into(),
        colony_core::QuorumResult::Pending => "Pending".into(),
        colony_core::QuorumResult::Escalated { .. } => "Escalated".into(),
    }
}

#[wasm_bindgen(js_name = trustScore)]
pub fn trust_score_js(merged: u32, rejected: u32, reverted: u32) -> f32 {
    trust_score(merged, rejected, reverted)
}

#[wasm_bindgen(js_name = tierFor)]
pub fn tier_for_js(trust: f32, merges: u32) -> String {
    match tier_for(trust, merges) {
        colony_core::TrustTier::Probation => "Probation".into(),
        colony_core::TrustTier::Member => "Member".into(),
        colony_core::TrustTier::Senior => "Senior".into(),
    }
}

#[wasm_bindgen(js_name = churnFrozen)]
pub fn churn_frozen_js(landings: u32) -> bool {
    churn_frozen(landings)
}

#[wasm_bindgen(js_name = pingPong)]
pub fn ping_pong_js(count: u32) -> bool {
    ping_pong(count)
}

#[wasm_bindgen(js_name = takeProbability)]
pub fn take_probability_js(urgency: f32, age_boost: f32, coverage: f32, theta: f32) -> f32 {
    take_probability(urgency, age_boost, coverage, theta)
}

#[wasm_bindgen(js_name = pickTask)]
pub fn pick_task_json(profile_json: &str, tasks_json: &str, now_ms: f64, rng: f32) -> String {
    let profile_in: ProfileIn = match serde_json::from_str(profile_json) {
        Ok(v) => v,
        Err(_) => return String::new(),
    };
    let tasks_in: Vec<TaskIn> = serde_json::from_str(tasks_json).unwrap_or_default();
    let profile = AgentProfile {
        id: profile_in.id,
        roles: vec![Role::Coder],
        specialties: profile_in.specialties,
        thresholds: profile_in.thresholds,
        trust: profile_in.trust,
        tier: match profile_in.tier.as_str() {
            "Senior" => TrustTier::Senior,
            "Probation" => TrustTier::Probation,
            _ => TrustTier::Member,
        },
        model_family: profile_in.model_family,
        budget_remaining: Budget { tokens: 0, wall_clock_ms: 0 },
    };
    let tasks: Vec<Task> = tasks_in
        .into_iter()
        .map(|task| Task {
            id: task.id,
            repo: "colony-demo".into(),
            title: String::new(),
            intent: String::new(),
            tags: task.tags,
            urgency: task.urgency,
            uncertainty: match task.uncertainty.as_str() {
                "Low" => Uncertainty::Low,
                "High" => Uncertainty::High,
                _ => Uncertainty::Medium,
            },
            paths_hint: vec![],
            state: TaskState::Open,
            created_at: task.created_at,
        })
        .collect();
    pick_task(&profile, &tasks, now_ms as u64, rng).unwrap_or_default()
}

#[wasm_bindgen(js_name = slotsFor)]
pub fn slots_for(uncertainty: &str) -> u32 {
    match uncertainty {
        "Low" => Uncertainty::Low.attempts() as u32,
        "High" => Uncertainty::High.attempts() as u32,
        _ => Uncertainty::Medium.attempts() as u32,
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileIn {
    id: String,
    specialties: Vec<String>,
    #[serde(default)]
    thresholds: std::collections::HashMap<String, f32>,
    trust: f32,
    tier: String,
    model_family: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskIn {
    id: String,
    urgency: f32,
    uncertainty: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    created_at: u64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoteIn {
    reviewer_id: String,
    model_family: String,
    verdict: String,
    #[serde(default)]
    score: f32,
}
