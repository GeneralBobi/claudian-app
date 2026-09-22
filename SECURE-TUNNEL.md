# Personal OpenAI Secure MCP Tunnel

Connections → ChatGPT now offers the user's own OpenAI tunnel. Each installation uses its own tunnel ID, runtime API key and selected vault. It does not register a device on the developer's relay. The legacy relay remains available for previously configured providers, but has no personal default server address.

Install the official Windows `tunnel-client.exe` following the linked OpenAI guide. Enter the tunnel ID and runtime key (Tunnels Read + Use) in Claudian, choose the executable, save and start. Add/select that tunnel in ChatGPT. Running means the local process exists; verify actual access with Claudian's connection test in ChatGPT. Provider account eligibility still applies.

Claudian owns the process, launches it with `windowsHide: true` and no shell, keeps it alive when minimized to the tray, and stops its process tree on Quit. Automatic start is opt-in. Unexpected exits require a manual restart. There is no public inbound vault port.

The runtime key is encrypted with Electron safeStorage (Windows DPAPI) in the OS user data folder under `secure-tunnel/settings.json`. It never goes to renderer status responses, command arguments, application logs, runtime configuration or packaging. The MCP child removes the key from its environment before serving memory tools. OS account/process compromise is outside this protection boundary.

The separate legacy web Core now reads `.env` outside the checkout, by default `%LOCALAPPDATA%/Claudian/web-core/.env`. `CLAUDIAN_ENV_FILE` can select another external location. `npm run dev`, `build`, `start`, `worker` and existing environment-dependent tests use the external runner. Keep external secrets backed up privately; never copy them into a repository. This desktop tunnel does not need the legacy web Core.

No actual key or personal tunnel ID belongs in this document or release files. `.env.example` is a placeholder template only.
