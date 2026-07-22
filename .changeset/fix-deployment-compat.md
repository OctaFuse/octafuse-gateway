---
"@octafuse/core": patch
"@octafuse/admin": patch
---

Fix MySQL 8.4 seed migration ambiguity; pin Admin to `@opennextjs/cloudflare@1.19.4` (upstream unused-OG bundle fix) and set `NEXT_PRIVATE_MINIMAL_MODE=1` so Workers skip the broken middleware-manifest require—no `patch-package` needed.
