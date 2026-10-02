use crate::model::TrustTier;

pub fn trust_score(merged: u32, rejected: u32, reverted: u32) -> f32 {
    let num = (merged + 1) as f32;
    let den = (merged + rejected + 3 * reverted + 2) as f32;
    num / den
}

pub fn tier_for(trust: f32, merges: u32) -> TrustTier {
    if trust < 0.55 {
        TrustTier::Probation
    } else if trust >= 0.8 && merges >= 10 {
        TrustTier::Senior
    } else {
        TrustTier::Member
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trust_formula_and_tier_boundaries() {
        assert_eq!(trust_score(0, 0, 0), 0.5);
        assert!((trust_score(1, 1, 1) - (2.0 / 7.0)).abs() < 1e-6);
        assert!((trust_score(10, 0, 0) - (11.0 / 12.0)).abs() < 1e-6);

        assert_eq!(tier_for(0.549, 100), TrustTier::Probation);
        assert_eq!(tier_for(0.55, 0), TrustTier::Member);
        assert_eq!(tier_for(0.8, 9), TrustTier::Member);
        assert_eq!(tier_for(0.799, 10), TrustTier::Member);
        assert_eq!(tier_for(0.8, 10), TrustTier::Senior);
        assert_eq!(tier_for(trust_score(9, 0, 0), 9), TrustTier::Member);
        assert_eq!(tier_for(trust_score(10, 0, 0), 10), TrustTier::Senior);
    }
}
