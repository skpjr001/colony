use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShardPattern {
    Children(String),
    Whole(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum ShardError {
    #[error("invalid shard pattern: {0}")]
    Invalid(String),
}

impl ShardPattern {
    pub fn parse(s: &str) -> Result<Self, ShardError> {
        let s = s.trim().trim_end_matches('/');
        if s.is_empty() || s.starts_with('/') {
            return Err(ShardError::Invalid(s.into()));
        }
        if let Some(prefix) = s.strip_suffix("/*") {
            if prefix.contains('*') {
                return Err(ShardError::Invalid(s.into()));
            }
            return Ok(Self::Children(prefix.into()));
        }
        if s.contains('*') {
            return Err(ShardError::Invalid(s.into()));
        }
        Ok(Self::Whole(s.into()))
    }

    fn prefix(&self) -> &str {
        match self {
            Self::Children(p) | Self::Whole(p) => p,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShardMap {
    pub enabled: bool,
    pub version: u32,
    pub default_shard: String,
    patterns: Vec<ShardPattern>,
}

fn under<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    path.strip_prefix(prefix)?.strip_prefix('/')
}

impl ShardMap {
    pub fn new(
        enabled: bool,
        version: u32,
        default_shard: &str,
        raw: &[String],
    ) -> Result<Self, ShardError> {
        let mut patterns = raw
            .iter()
            .map(|s| ShardPattern::parse(s))
            .collect::<Result<Vec<_>, _>>()?;
        patterns.sort_by(|a, b| {
            b.prefix()
                .len()
                .cmp(&a.prefix().len())
                .then_with(|| match (a, b) {
                    (ShardPattern::Children(_), ShardPattern::Whole(_)) => Ordering::Less,
                    (ShardPattern::Whole(_), ShardPattern::Children(_)) => Ordering::Greater,
                    _ => Ordering::Equal,
                })
        });
        Ok(Self {
            enabled,
            version,
            default_shard: default_shard.into(),
            patterns,
        })
    }

    pub fn shard_for_path(&self, path: &str) -> String {
        if !self.enabled {
            return self.default_shard.clone();
        }
        for p in &self.patterns {
            match p {
                ShardPattern::Children(prefix) => {
                    if let Some(rest) = under(path, prefix) {
                        return match rest.split_once('/') {
                            Some((child, _)) => format!("{prefix}/{child}"),
                            None => prefix.clone(),
                        };
                    }
                }
                ShardPattern::Whole(prefix) => {
                    if under(path, prefix).is_some() {
                        return prefix.clone();
                    }
                }
            }
        }
        self.default_shard.clone()
    }
}

pub fn shards_for_glob(map: &ShardMap, glob: &str, known_shards: &[String]) -> Vec<String> {
    if !map.enabled {
        return vec![map.default_shard.clone()];
    }

    let lit = literal_prefix(glob);
    if lit.is_empty() {
        let mut out = known_shards.to_vec();
        out.push(map.default_shard.clone());
        return sort_dedupe(out);
    }

    if !glob_has_meta(glob) {
        return vec![map.shard_for_path(glob)];
    }

    if let Some(shard) = single_shard(map, &lit) {
        return vec![shard];
    }

    let mut out: Vec<String> = known_shards
        .iter()
        .filter(|key| key_has_prefix(key, &lit))
        .cloned()
        .collect();
    if map.patterns.iter().any(|p| p.prefix() == lit) {
        out.push(lit.clone());
    }
    if !under_any_pattern(map, &lit) {
        out.push(map.default_shard.clone());
    }
    sort_dedupe(out)
}

pub fn is_broad(shards: &[String], max_fanout: usize) -> bool {
    shards.len() > max_fanout
}

fn literal_prefix(glob: &str) -> String {
    let mut parts = Vec::new();
    for seg in glob.split('/') {
        if seg.is_empty() {
            continue;
        }
        if segment_has_meta(seg) {
            break;
        }
        parts.push(seg);
    }
    parts.join("/")
}

fn segment_has_meta(seg: &str) -> bool {
    seg.contains('*') || seg.contains('?') || seg.contains('[')
}

fn glob_has_meta(glob: &str) -> bool {
    glob.contains('*') || glob.contains('?') || glob.contains('[')
}

fn key_has_prefix(key: &str, prefix: &str) -> bool {
    key == prefix || key.starts_with(&format!("{prefix}/"))
}

fn under_any_pattern(map: &ShardMap, lit: &str) -> bool {
    map.patterns.iter().any(|p| {
        let prefix = p.prefix();
        lit == prefix || key_has_prefix(lit, prefix)
    })
}

fn single_shard(map: &ShardMap, lit: &str) -> Option<String> {
    if map.patterns.iter().any(|p| {
        let prefix = p.prefix();
        prefix != lit && key_has_prefix(prefix, lit)
    }) {
        return None;
    }
    let file_probe = map.shard_for_path(&format!("{lit}/x"));
    let nested_probe = map.shard_for_path(&format!("{lit}/x/y"));
    if file_probe == nested_probe {
        Some(file_probe)
    } else {
        None
    }
}

fn sort_dedupe(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v.dedup();
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn example_map() -> ShardMap {
        ShardMap::new(
            true,
            1,
            "root",
            &["src/*".into(), "crates/*".into(), "docs".into()],
        )
        .unwrap()
    }

    #[test]
    fn shard_table_from_plan() {
        let map = example_map();
        assert_eq!(map.shard_for_path("src/payments/refund.rs"), "src/payments");
        assert_eq!(map.shard_for_path("src/api/routes/v2.rs"), "src/api");
        assert_eq!(map.shard_for_path("src/main.rs"), "src");
        assert_eq!(
            map.shard_for_path("crates/colony-core/src/lib.rs"),
            "crates/colony-core"
        );
        assert_eq!(map.shard_for_path("docs/guide/intro.md"), "docs");
        assert_eq!(map.shard_for_path("README.md"), "root");
        assert_eq!(map.shard_for_path("Cargo.toml"), "root");
        assert_eq!(map.shard_for_path(".github/ci.yml"), "root");
    }

    #[test]
    fn parse_rejects_invalid_patterns() {
        assert!(ShardPattern::parse("/src").is_err());
        assert!(ShardPattern::parse("src/**").is_err());
        assert!(ShardPattern::parse("src/*/foo").is_err());
        assert!(ShardPattern::parse("").is_err());
    }

    #[test]
    fn children_wins_over_equal_length_whole() {
        let a = ShardMap::new(true, 1, "root", &["src".into(), "src/*".into()]).unwrap();
        let b = ShardMap::new(true, 1, "root", &["src/*".into(), "src".into()]).unwrap();
        assert_eq!(a.shard_for_path("src/payments/a.rs"), "src/payments");
        assert_eq!(b.shard_for_path("src/payments/a.rs"), "src/payments");
    }

    #[test]
    fn shards_for_glob_payments_and_broad_toml() {
        let map = example_map();
        assert_eq!(
            shards_for_glob(&map, "src/payments/**", &[]),
            vec!["src/payments".to_string()]
        );
        assert_eq!(
            shards_for_glob(&map, "docs/**", &[]),
            vec!["docs".to_string()]
        );
        let known = vec![
            "src/payments".into(),
            "src/api".into(),
            "docs".into(),
            "root".into(),
        ];
        let got = shards_for_glob(&map, "**/*.toml", &known);
        for s in ["src/payments", "src/api", "docs", "root"] {
            assert!(got.iter().any(|g| g == s), "{got:?}");
        }
    }

    #[test]
    fn is_broad_above_max_fanout() {
        let shards = vec!["a".into(), "b".into()];
        assert!(!is_broad(&shards, 2));
        assert!(is_broad(&shards, 1));
    }

    proptest! {
        #[test]
        fn prop_shard_for_path_one_nonempty(
            path in "[A-Za-z0-9._-]{1,16}(/[A-Za-z0-9._-]{1,16}){0,5}"
        ) {
            prop_assert!(!path.starts_with('/'));
            let patterns = vec!["src/*".to_string(), "crates/*".to_string(), "docs".to_string()];
            let enabled = ShardMap::new(true, 1, "root", &patterns).unwrap();
            let shard = enabled.shard_for_path(&path);
            prop_assert!(!shard.is_empty());
            prop_assert_eq!(shard.split('\0').count(), 1);

            let disabled = ShardMap::new(false, 1, "fallback", &patterns).unwrap();
            prop_assert_eq!(disabled.shard_for_path(&path), disabled.default_shard.clone());
            prop_assert_eq!(disabled.default_shard, "fallback");
        }
    }
}
