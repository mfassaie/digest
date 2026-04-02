# Domain Overview

## Domain

Web content fetching and transformation for AI agent consumption.

## Core Concepts

| Concept          | Definition                                                     |
|------------------|----------------------------------------------------------------|
| WebFetch         | Fetching a web page and making it available as clean files     |
| Timeout          | Hard upper bound on fetch duration to prevent hangs            |
| Content extraction | Removing navigation, ads, and clutter from HTML to isolate main content (via defuddle) |
| Disk cache       | Filesystem-based cache with HTTP conditional validation        |
| Cache entry      | Directory containing raw file, markdown file (if applicable), and metadata |
| Content-type branching | Different processing paths based on HTTP Content-Type header |

## Entities

| Entity       | Description                                                          |
|--------------|----------------------------------------------------------------------|
| FetchRequest | Validated URL + timeout + prompt. URL normalised (HTTPS).            |
| FetchResult  | Status, content-type, headers, body (raw bytes).                     |
| CacheEntry   | Directory on disk containing raw file, markdown file, and meta.json. |
| CacheMeta    | ETag, Last-Modified, content-type, url, fetchedAt.                   |
| CliArgs      | Parsed subcommand (install/uninstall) and scope (project/global).    |
| ConfigTarget | Resolved file paths for MCP config, settings, and local settings.    |

## Bounded Contexts

Single bounded context: web content fetching and transformation.

## Domain Invariants

| ID      | Invariant                                              |
|---------|--------------------------------------------------------|
| INV-001 | A fetch must complete or abort within timeout_seconds  |
| INV-002 | HTTP URLs are always upgraded to HTTPS before fetching |
| INV-003 | Cross-host redirects are never followed automatically  |
| INV-004 | Same-host redirects are followed up to 5 hops         |
| INV-005 | Cache entries always contain meta.json                 |
| INV-006 | HTML content produces both raw and markdown files      |
| INV-007 | Binary content is saved without markdown conversion    |
| INV-008 | Tool response never contains page content inline       |
