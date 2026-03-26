# pi-yagami-search

Pi package that adds Yagami-backed web search tools.

## Install

From npm:

```bash
pi install npm:@ahkohd/pi-yagami-search
```

From a local checkout:

```bash
pi install ./packages/pi-yagami-search
```

## Runtime requirements

- A running Yagami daemon (default: `http://127.0.0.1:43111`)
- Optionally set `YAGAMI_URL` to override the daemon URL

```bash
export YAGAMI_URL=http://127.0.0.1:43111
```

## Tools provided

- `web_search`
- `get_code_context`
- `fetch_content`
- `company_research`
- `web_search_advanced`
- `find_similar`
- `deep_research_start`
- `deep_research_check`

These tool names match Pi's common search tool surface.
