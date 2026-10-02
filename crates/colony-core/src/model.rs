use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub type AgentId = String;
pub type TaskId = String;
pub type AttemptId = String;
pub type ShardKey = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Coder,
    Reviewer,
    Arbiter,
    Integrator,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrustTier {
    Probation,
    Member,
    Senior,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    pub tokens: u64,
    pub wall_clock_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: AgentId,
    pub roles: Vec<Role>,
    pub specialties: Vec<String>,
    pub thresholds: HashMap<String, f32>,
    pub trust: f32,
    pub tier: TrustTier,
    pub model_family: String,
    pub budget_remaining: Budget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Uncertainty {
    Low,
    Medium,
    High,
}

impl Uncertainty {
    pub fn attempts(self) -> u8 {
        match self {
            Self::Low => 1,
            Self::Medium => 2,
            Self::High => 3,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskState {
    Open,
    Exploring {
        attempts: Vec<AttemptId>,
    },
    Evaluating,
    InReview {
        candidate: AttemptId,
    },
    Queued {
        candidate: AttemptId,
        train: Option<String>,
    },
    Merged {
        commit: String,
    },
    Escalated {
        reason: String,
    },
    Abandoned {
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: TaskId,
    pub repo: String,
    pub title: String,
    pub intent: String,
    pub tags: Vec<String>,
    pub urgency: f32,
    pub uncertainty: Uncertainty,
    pub paths_hint: Vec<String>,
    pub state: TaskState,
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub id: AttemptId,
    pub task_id: TaskId,
    pub agent_id: AgentId,
    pub fork_repo: String,
    pub head_commit: Option<String>,
    pub evidence: Option<Evidence>,
    pub score: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub required_tests_passed: bool,
    pub tests_passed: u32,
    pub tests_total: u32,
    pub lines_changed: u32,
    pub files_changed: Vec<String>,
    pub bench_delta_pct: Option<f32>,
    pub agent_rationale: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uncertainty_attempts() {
        assert_eq!(Uncertainty::Low.attempts(), 1);
        assert_eq!(Uncertainty::Medium.attempts(), 2);
        assert_eq!(Uncertainty::High.attempts(), 3);
    }

    #[test]
    fn serde_camel_case() {
        let profile = AgentProfile {
            id: "a".into(),
            roles: vec![Role::Coder],
            specialties: vec!["rust".into()],
            thresholds: HashMap::from([("rust".into(), 0.4)]),
            trust: 0.5,
            tier: TrustTier::Member,
            model_family: "opus".into(),
            budget_remaining: Budget {
                tokens: 10,
                wall_clock_ms: 20,
            },
        };
        let v = serde_json::to_value(&profile).unwrap();
        assert!(v.get("modelFamily").is_some());
        assert!(v.get("budgetRemaining").is_some());
        assert!(v.get("model_family").is_none());

        let state = TaskState::InReview {
            candidate: "att".into(),
        };
        let sv = serde_json::to_value(&state).unwrap();
        assert!(sv.get("inReview").is_some());
        assert_eq!(sv["inReview"]["candidate"], "att");
    }
}
