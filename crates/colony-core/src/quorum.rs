use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewVote {
    pub reviewer_id: String,
    pub model_family: String,
    pub verdict: Verdict,
    pub score: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    Approve,
    Reject,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuorumCfg {
    pub k: u32,
    pub n: u32,
}

impl Default for QuorumCfg {
    fn default() -> Self {
        Self { k: 2, n: 3 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuorumResult {
    Approved,
    Rejected,
    Pending,
    Escalated { reason: String },
}

pub fn evaluate_quorum(
    author_id: &str,
    author_family: &str,
    votes: &[ReviewVote],
    security_tagged: bool,
    timed_out: bool,
    cfg: &QuorumCfg,
) -> QuorumResult {
    let votes: Vec<&ReviewVote> = votes
        .iter()
        .filter(|v| v.reviewer_id != author_id)
        .collect();
    let approves = votes
        .iter()
        .filter(|v| v.verdict == Verdict::Approve)
        .count() as u32;
    let rejects = votes
        .iter()
        .filter(|v| v.verdict == Verdict::Reject)
        .count() as u32;
    let diverse = votes
        .iter()
        .any(|v| v.verdict == Verdict::Approve && v.model_family != author_family);

    if security_tagged && rejects > 0 {
        return QuorumResult::Escalated {
            reason: "security-tagged reject".into(),
        };
    }
    if approves >= cfg.k && diverse {
        return QuorumResult::Approved;
    }
    if timed_out {
        return QuorumResult::Escalated {
            reason: "timed out".into(),
        };
    }
    let remaining = cfg.n.saturating_sub(votes.len() as u32);
    if approves.saturating_add(remaining) < cfg.k {
        return QuorumResult::Rejected;
    }
    QuorumResult::Pending
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vote(id: &str, family: &str, verdict: Verdict) -> ReviewVote {
        ReviewVote {
            reviewer_id: id.into(),
            model_family: family.into(),
            verdict,
            score: 1.0,
        }
    }

    #[test]
    fn quorum_approve_pending_security_and_author_ignored() {
        let cfg = QuorumCfg::default();
        let different = vec![
            vote("r1", "a", Verdict::Approve),
            vote("r2", "b", Verdict::Approve),
        ];
        assert_eq!(
            evaluate_quorum("author", "a", &different, false, false, &cfg),
            QuorumResult::Approved
        );

        let same = vec![
            vote("r1", "a", Verdict::Approve),
            vote("r2", "a", Verdict::Approve),
        ];
        assert_eq!(
            evaluate_quorum("author", "a", &same, false, false, &cfg),
            QuorumResult::Pending
        );

        let sec = vec![vote("r1", "b", Verdict::Reject)];
        assert!(matches!(
            evaluate_quorum("author", "a", &sec, true, false, &cfg),
            QuorumResult::Escalated { .. }
        ));

        let ignored = vec![
            vote("author", "b", Verdict::Approve),
            vote("r1", "b", Verdict::Approve),
        ];
        assert_eq!(
            evaluate_quorum("author", "a", &ignored, false, false, &cfg),
            QuorumResult::Pending
        );

        let author_reject = vec![vote("author", "b", Verdict::Reject)];
        assert_eq!(
            evaluate_quorum("author", "a", &author_reject, true, false, &cfg),
            QuorumResult::Pending
        );
    }

    #[test]
    fn quorum_timeout_and_impossible() {
        let cfg = QuorumCfg::default();
        assert!(matches!(
            evaluate_quorum("author", "a", &[], false, true, &cfg),
            QuorumResult::Escalated { .. }
        ));
        let rejects = vec![
            vote("r1", "b", Verdict::Reject),
            vote("r2", "c", Verdict::Reject),
        ];
        assert_eq!(
            evaluate_quorum("author", "a", &rejects, false, false, &cfg),
            QuorumResult::Rejected
        );
    }
}
