use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "colony")]
struct Cli {
    #[arg(long, default_value = "https://colony.sachinkumarskrose.workers.dev")]
    url: String,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Health,
    Tasks,
    Board,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let path = match cli.cmd {
        Cmd::Health => "/api/health",
        Cmd::Tasks => "/api/tasks",
        Cmd::Board => "/api/repos/colony-demo/board",
    };
    let body = reqwest::get(format!("{}{}", cli.url.trim_end_matches('/'), path))
        .await?
        .text()
        .await?;
    println!("{body}");
    Ok(())
}
