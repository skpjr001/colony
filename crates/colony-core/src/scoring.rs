use crate::model::Evidence;

pub fn score_attempt(ev: &Evidence, mean_review: f32) -> Option<f32> {
    if !ev.required_tests_passed {
        return None;
    }
    let test_ratio = if ev.tests_total == 0 {
        0.0
    } else {
        ev.tests_passed as f32 / ev.tests_total as f32
    };
    let normalized_diff_size = (ev.lines_changed as f32 / 400.0).clamp(0.0, 1.0);
    let perf_term = match ev.bench_delta_pct {
        Some(d) => ((-d) / 20.0).clamp(-1.0, 1.0) * 0.5 + 0.5,
        None => 0.5,
    };
    let score = 0.45 * test_ratio
        + 0.25 * mean_review.clamp(0.0, 1.0)
        + 0.15 * (1.0 - normalized_diff_size)
        + 0.15 * perf_term;
    Some(score)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence(passed: bool) -> Evidence {
        Evidence {
            required_tests_passed: passed,
            tests_passed: 8,
            tests_total: 10,
            lines_changed: 200,
            files_changed: vec!["a.rs".into()],
            bench_delta_pct: Some(-10.0),
            agent_rationale: "ok".into(),
        }
    }

    #[test]
    fn scoring_gate_fails_without_required_tests() {
        assert_eq!(score_attempt(&evidence(false), 1.0), None);
    }

    #[test]
    fn scoring_formula() {
        let score = score_attempt(&evidence(true), 1.0).unwrap();
        let expected = 0.45 * 0.8 + 0.25 * 1.0 + 0.15 * 0.5 + 0.15 * 0.75;
        assert!((score - expected).abs() < 1e-5);
    }
}
