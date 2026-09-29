# MST MCP Server (mst-mcp)

> Source: MST official developer docs (docs.mstblockchain.com), copied 2026-09-29 for team reference. Not our content — check the live docs for updates.

The MST Blockchain MCP server is a **documentation gateway**: it lets AI assistants (including Claude) access, search and surface the MST blockchain documentation. It exposes **three tools**.

## What is MCP?
Model Context Protocol is an open standard (introduced by Anthropic) for connecting AI models to external data sources and tools via "MCP servers" that expose resources, tools and prompts.

## Endpoint
`https://mcp.mstblockchain.com/sse`

## Connecting in Claude.ai (per MST docs)
1. Open Claude.ai → Settings → Connectors (or MCP Apps)
2. Add MCP server / connect new MCP
3. URL: `https://mcp.mstblockchain.com/sse`
4. Name: `mst-mcp`
5. Authentication: use the OAuth client ID and secret published in MST's MCP docs page (docs.mstblockchain.com). Not copied here: the repo never stores credentials, even public ones.
6. Save and activate. Claude calls the mst-mcp tools automatically for MST questions.

## Notes for our team
- It serves **documentation only**. It never needs our wallet keys or any private key; never give it one.
- Useful for our coding agents (Claude Code, Antigravity) to look up MST facts instead of guessing.

## Resources
| Resource | Link |
|---|---|
| MST website | https://mstblockchain.com |
| MCP endpoint | https://mcp.mstblockchain.com/sse |
| Anthropic docs | https://docs.anthropic.com |
