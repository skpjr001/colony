use crate::model::{AgentProfile, Task, TaskId, TaskState, TrustTier, Uncertainty};

pub fn take_probability(urgency: f32, age_boost: f32, coverage: f32, theta: f32) -> f32 {
    let s = urgency * age_boost * (1.0 - coverage);
    if s == 0.0 && theta == 0.0 {
        return 0.0;
    }
    let s2 = s * s;
    let t2 = theta * theta;
    s2 / (s2 + t2)
}

pub fn pick_task(profile: &AgentProfile, tasks: &[Task], now_ms: u64, rng: f32) -> Option<TaskId> {
    for task in tasks {
        if !matches!(task.state, TaskState::Open) {
            continue;
        }
        if profile.tier == TrustTier::Probation && task.uncertainty != Uncertainty::Low {
            continue;
        }
        let theta = theta_for(profile, task);
        let age_hours = now_ms.saturating_sub(task.created_at) as f32 / 3_600_000.0;
        let age_boost = 1.0 + age_hours.min(24.0) / 24.0;
        let p = take_probability(task.urgency, age_boost, 0.0, theta);
        if rng < p {
            return Some(task.id.clone());
        }
    }
    None
}

fn theta_for(profile: &AgentProfile, task: &Task) -> f32 {
    task.tags
        .iter()
        .filter(|tag| profile.specialties.iter().any(|s| s == *tag))
        .map(|tag| profile.thresholds.get(tag).copied().unwrap_or(0.8))
        .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .unwrap_or(0.8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Budget, Role};
    use std::collections::HashMap;

    #[test]
    fn take_probability_half_when_s_equals_theta() {
        let p = take_probability(1.0, 1.0, 0.0, 1.0);
        assert!((p - 0.5).abs() < 1e-6);
    }

    #[test]
    fn take_probability_zero_when_s_and_theta_zero() {
        assert_eq!(take_probability(0.0, 1.0, 0.0, 0.0), 0.0);
    }

    fn profile(tier: TrustTier, specialties: &[(&str, f32)]) -> AgentProfile {
        AgentProfile {
            id: "agent".into(),
            roles: vec![Role::Coder],
            specialties: specialties.iter().map(|(s, _)| (*s).to_string()).collect(),
            thresholds: specialties
                .iter()
                .map(|(s, t)| ((*s).to_string(), *t))
                .collect::<HashMap<_, _>>(),
            trust: 0.5,
            tier,
            model_family: "a".into(),
            budget_remaining: Budget {
                tokens: 1,
                wall_clock_ms: 1,
            },
        }
    }

    fn task(id: &str, tags: &[&str], uncertainty: Uncertainty, state: TaskState) -> Task {
        Task {
            id: id.into(),
            repo: "r".into(),
            title: "t".into(),
            intent: "i".into(),
            tags: tags.iter().map(|s| (*s).to_string()).collect(),
            urgency: 1.0,
            uncertainty,
            paths_hint: vec![],
            state,
            created_at: 0,
        }
    }

    #[test]
    fn pick_task_first_passing_rng_and_probation_skip() {
        let agent = profile(TrustTier::Member, &[("a", 1.0), ("b", 0.01)]);
        let tasks = vec![
            task("first", &["a"], Uncertainty::Low, TaskState::Open),
            task("second", &["b"], Uncertainty::High, TaskState::Open),
        ];
        assert_eq!(pick_task(&agent, &tasks, 0, 0.6).as_deref(), Some("second"));
        assert_eq!(pick_task(&agent, &tasks, 0, 0.49).as_deref(), Some("first"));

        let probation = profile(TrustTier::Probation, &[("b", 0.01)]);
        let high = vec![task("high", &["b"], Uncertainty::High, TaskState::Open)];
        assert_eq!(pick_task(&probation, &high, 0, 0.0), None);
        let low = vec![task("low", &["b"], Uncertainty::Low, TaskState::Open)];
        assert_eq!(pick_task(&probation, &low, 0, 0.0).as_deref(), Some("low"));
    }
}
