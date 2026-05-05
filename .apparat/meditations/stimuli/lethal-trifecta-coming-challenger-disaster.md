---
source: https://www.youtube.com/watch?v=wc8FBhQtdsA
date: 2026-04-03
description: Agent that audits agentic systems for the lethal trifecta — the combination of private data access, exposure to malicious instructions, and an exfiltration channel — and refuses or flags any architecture that has all three legs present.
---

# The Lethal Trifecta: The Coming Challenger Disaster

Prompt injection is a class of vulnerabilities in applications built on top of LLMs. The **lethal trifecta** is the most dangerous subset.

An agent has a lethal trifecta when all three are present simultaneously:

1. **Access to private data** — e.g. a private inbox, personal documents, sensitive context
2. **Exposure to malicious instructions** — e.g. an attacker can get text into the system (send an email, inject content into a web page)
3. **An exfiltration mechanism** — e.g. the agent can send data back out (forward an email, make an HTTP request)

Classic example: an email agent that reads your inbox, anyone can email it instructions, and it can forward emails back. That's a fully realized lethal trifecta.

The only fix is to cut off one of the three legs. If you can't eliminate private data access or malicious instruction exposure, you must remove any exfiltration channel.

This is not theoretical. A large-scale failure — a "Challenger disaster of AI" — is likely coming from this class of vulnerability.
