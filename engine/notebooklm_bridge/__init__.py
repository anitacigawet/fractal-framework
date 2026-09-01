"""
notebooklm_bridge — Fractal Framework's NotebookLM adapter.

Connects the local wizard to the unofficial NotebookLM Python wrapper for
research, source ingestion, persona configuration, and source-cited campaign
content generation.

Campaign-specific values are supplied by the wizard as runtime substitutions.

Pre-requisite: run `notebooklm login` once (or use the wizard's
reauthentication flow)
to generate session cookies.

The wizard invokes the adapter through `python -m notebooklm_bridge.runner`.
"""

__version__ = "0.0.1"
