# Claude Code setup (ny maskine)

Opret `.mcp.json` i rod-mappen:
```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", "DIN_SUPABASE_TOKEN"]
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "env": {
        "MEMORY_FILE_PATH": ".claude/memory.json"
      }
    }
  }
}
```
Supabase access token: https://supabase.com/dashboard/account/tokens
