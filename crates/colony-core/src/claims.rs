use crate::model::{AgentId, ShardKey, TaskId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    pub id: String,
    pub agent_id: AgentId,
    pub task_id: TaskId,
    pub paths: Vec<String>,
    pub shards: Vec<ShardKey>,
    pub shard_map_version: u32,
    pub intent: String,
    pub strength0: f32,
    pub last_heartbeat_ms: u64,
    pub ttl_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimCfg {
    pub lambda_per_min: f32,
    pub min_strength: f32,
    pub heartbeat_secs: u64,
    pub ttl_ms: u64,
}

impl Default for ClaimCfg {
    fn default() -> Self {
        Self {
            lambda_per_min: 0.2,
            min_strength: 0.2,
            heartbeat_secs: 90,
            ttl_ms: 30 * 60 * 1000,
        }
    }
}

pub fn strength(c: &Claim, now_ms: u64, lambda_per_min: f32) -> f32 {
    let idle_min = now_ms.saturating_sub(c.last_heartbeat_ms) as f32 / 60_000.0;
    c.strength0 * (-lambda_per_min * idle_min).exp()
}

pub fn is_alive(c: &Claim, now_ms: u64, cfg: &ClaimCfg) -> bool {
    strength(c, now_ms, cfg.lambda_per_min) >= cfg.min_strength
        && now_ms < c.last_heartbeat_ms.saturating_add(c.ttl_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claim(strength0: f32, last: u64, ttl: u64) -> Claim {
        Claim {
            id: "c".into(),
            agent_id: "a".into(),
            task_id: "t".into(),
            paths: vec![],
            shards: vec![],
            shard_map_version: 1,
            intent: "fix".into(),
            strength0,
            last_heartbeat_ms: last,
            ttl_ms: ttl,
        }
    }

    #[test]
    fn claim_cfg_defaults() {
        let cfg = ClaimCfg::default();
        assert_eq!(cfg.lambda_per_min, 0.2);
        assert_eq!(cfg.min_strength, 0.2);
        assert_eq!(cfg.heartbeat_secs, 90);
        assert_eq!(cfg.ttl_ms, 30 * 60 * 1000);
    }

    #[test]
    fn decay_idle_zero_and_eight_minutes() {
        let c = claim(1.0, 0, 1_800_000);
        let fresh = strength(&c, 0, 0.2);
        assert!((fresh - 1.0).abs() < 1e-6);

        let idle = strength(&c, 8 * 60_000, 0.2);
        let expected = (-1.6f32).exp();
        assert!((idle - expected).abs() < 1e-5);
        assert!((idle - 0.202).abs() < 0.01);
    }

    #[test]
    fn is_alive_false_after_ttl_even_if_strength_high() {
        let cfg = ClaimCfg {
            lambda_per_min: 0.0,
            min_strength: 0.2,
            ..ClaimCfg::default()
        };
        let c = claim(1.0, 1_000, 1_800_000);
        assert!((strength(&c, 1_000 + 1_800_000, 0.0) - 1.0).abs() < 1e-6);
        assert!(is_alive(&c, 1_000 + 1_800_000 - 1, &cfg));
        assert!(!is_alive(&c, 1_000 + 1_800_000, &cfg));
    }
}
