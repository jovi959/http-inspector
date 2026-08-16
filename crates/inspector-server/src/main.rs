/// Runs the browser-development composition root; packaged Tauri uses the same server crate later.
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = inspector_server::ServerConfig::development()?;
    let mut server = inspector_server::start(config).await?;
    println!("HTTP Inspector development service listening at http://{}", server.address);
    tokio::signal::ctrl_c().await?;
    server.shutdown().await;
    Ok(())
}
