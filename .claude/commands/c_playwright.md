# Playwright MCP

Playwright is installed but disabled (21 tools, Chromium browser automation).

**To enable:** rename `.mcp.json.disabled` → `.mcp.json` then restart Claude Code:

```
mv ~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/playwright/.mcp.json.disabled \
   ~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/playwright/.mcp.json
```

**For browser automation in this project:** use Crawlio (`browser-automation` skill) — already loaded.
