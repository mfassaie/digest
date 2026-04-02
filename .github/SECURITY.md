# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public issue.**

Instead, use [GitHub private vulnerability reporting](https://github.com/mfassaie/digest/security/advisories/new) to submit your report.

You can expect:
- Acknowledgement within 48 hours
- Triage and initial assessment within 7 days
- A fix or mitigation plan within 30 days for confirmed vulnerabilities

## Scope

This project fetches URLs by design. The following are not vulnerabilities:
- The tool fetching a URL that was provided as input
- The tool saving fetched content to the artefact store
- The tool returning file paths to stored artefacts

Security concerns include:
- Path traversal in artefact store operations
- Arbitrary code execution via crafted responses
- Credentials or secrets leaked in logs or responses
