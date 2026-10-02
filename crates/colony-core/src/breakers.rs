pub fn churn_frozen(landings_in_window: u32) -> bool {
    landings_in_window > 4
}

pub fn ping_pong(revert_reapply_count: u32) -> bool {
    revert_reapply_count >= 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breakers() {
        assert!(!churn_frozen(4));
        assert!(churn_frozen(5));
        assert!(!ping_pong(1));
        assert!(ping_pong(2));
    }
}
