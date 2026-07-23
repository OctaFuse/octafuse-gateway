---
"octafuse": patch
"@octafuse/admin": patch
---

Fix Admin console login being kicked out immediately on plain HTTP (e.g. Docker quickstart): make `admin_session` `Secure` opt-in via `ADMIN_COOKIE_SECURE` instead of always-on ([#36](https://github.com/OctaFuse/octafuse-gateway/issues/36)).
