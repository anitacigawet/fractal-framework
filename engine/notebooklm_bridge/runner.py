"""
Command-line adapter between the Fractal Framework wizard and NotebookLM.

The wizard uses this module to inspect authentication, create notebooks, add
sources, run research, configure a notebook persona, send production prompts,
and list notebook sources. Prompt wording lives in Markdown files; this module
only loads instruction blocks, substitutes runtime values, invokes the client,
and records responses under outputs/.

Examples:
    py -m notebooklm_bridge.runner status
    py -m notebooklm_bridge.runner create-notebook --county demo --title "Demo"
    py -m notebooklm_bridge.runner phase-a --county demo --notebook-id <id> --prompt-path <file>
    py -m notebooklm_bridge.runner phase-b --county demo --notebook-id <id>
    py -m notebooklm_bridge.runner query --county demo --notebook-id <id> --prompt-path <file> --output-name hero
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .auth_check import check_auth_status_async
from .client import BridgeNotebookLMClient, get_budget_status

logger = logging.getLogger("notebooklm_bridge.runner")

_BRIDGE_DIR = Path(__file__).resolve().parent
QUERIES_DIR = _BRIDGE_DIR / "queries"
OUTPUTS_DIR = _BRIDGE_DIR / "outputs"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _county_dir(county: str) -> Path:
    """Return outputs/<county>/, creating it when needed."""
    path = OUTPUTS_DIR / county
    path.mkdir(parents=True, exist_ok=True)
    return path


def _resolve_file(raw_path: str) -> Path:
    """Resolve an absolute path or a path relative to the bridge package."""
    path = Path(raw_path)
    if path.is_file():
        return path.resolve()

    bridge_relative = _BRIDGE_DIR / path
    if bridge_relative.is_file():
        return bridge_relative.resolve()

    raise FileNotFoundError(f"File not found: {raw_path}")


def _load_substitutions(args: argparse.Namespace) -> dict[str, str]:
    """Parse repeatable --var KEY=value arguments."""
    substitutions: dict[str, str] = {}
    for value in getattr(args, "var", None) or []:
        if "=" not in value:
            logger.warning(
                "Skipping malformed --var %r (expected KEY=value)", value
            )
            continue
        key, raw_value = value.split("=", 1)
        key = key.strip()
        if not key:
            logger.warning("Skipping malformed --var %r (empty key)", value)
            continue
        substitutions[key] = raw_value.strip()
    return substitutions


def _substitute(text: str, substitutions: dict[str, str]) -> str:
    """Replace [KEY] placeholders. Unmatched placeholders remain literal."""
    result = text
    for key, value in substitutions.items():
        result = result.replace(f"[{key}]", value)
    return result


def _strip_front_matter(text: str) -> str:
    """Remove an opening YAML-style front-matter block without parsing it."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return text

    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return "\n".join(lines[index + 1 :]).lstrip()
    return text


def _extract_instructions_block(text: str) -> str:
    """Return the first Instructions section from a prompt Markdown file."""
    heading = re.search(
        r"^(#{1,6})\s+Instructions\b[^\n]*$",
        text,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    if heading is None:
        return ""

    level = len(heading.group(1))
    body = text[heading.end() :].lstrip("\r\n")
    kept: list[str] = []
    for line in body.splitlines():
        next_heading = re.match(r"^(#{1,6})\s+", line)
        if next_heading and len(next_heading.group(1)) <= level:
            break
        if line.strip() == "---":
            break
        kept.append(line)
    return "\n".join(kept).strip()


def _extract_prompt(file_path: Path) -> str:
    """Load a prompt and return its Instructions section."""
    text = file_path.read_text(encoding="utf-8")
    body = _strip_front_matter(text)
    instructions = _extract_instructions_block(body)
    if not instructions:
        raise ValueError(
            f"{file_path} has no Markdown heading named Instructions."
        )
    return instructions


def _write_response(
    county: str,
    output_name: str,
    response_body: str,
    front_matter: dict,
) -> Path:
    """Write a response and its audit metadata to outputs/<county>/."""
    path = _county_dir(county) / f"{output_name}.md"
    lines = ["---"]
    for key, value in front_matter.items():
        if isinstance(value, (dict, list)):
            lines.append(f"{key}: {json.dumps(value)}")
        else:
            lines.append(f"{key}: {value}")
    lines.extend(["---", "", response_body, ""])
    path.write_text("\n".join(lines), encoding="utf-8")
    logger.info("Wrote %s", path.relative_to(_BRIDGE_DIR.parent))
    return path


async def cmd_status(args: argparse.Namespace) -> int:
    print("─" * 60)
    print("  NotebookLM Bridge — Status")
    print("─" * 60)
    auth = await check_auth_status_async(force=args.force)
    print(f"  Auth:    {auth.get('status')}")
    if auth.get("details"):
        print(f"           {auth.get('details')}")
    if auth.get("cache_age_seconds") is not None:
        print(f"           (cache age: {auth['cache_age_seconds']}s)")

    budget = get_budget_status()
    print()
    print(
        f"  Budget:  {budget['count_today']}/{budget['limit']} calls today  "
        f"({budget['remaining']} remaining)"
    )
    print(f"           enabled={budget['enabled']}  date={budget['date']}")
    print("─" * 60)
    return 0 if auth.get("status") == "valid" else 1


async def cmd_create_notebook(args: argparse.Namespace) -> int:
    client = BridgeNotebookLMClient()
    await client.open()
    try:
        notebook_id = await client.create_notebook(args.title)
        print("\nNotebook created.")
        print(f"  ID:     {notebook_id}")
        print(f"  Title:  {args.title}")
        print(
            "\nSave this ID. Use it as --notebook-id <id> in subsequent commands.\n"
        )
        return 0
    finally:
        await client.close()


async def cmd_add_source(args: argparse.Namespace) -> int:
    try:
        file_path = _resolve_file(args.file)
    except FileNotFoundError:
        print(f"  ERROR: --file '{args.file}' not found.")
        return 1

    client = BridgeNotebookLMClient()
    await client.open()
    try:
        print(f"\nAdding source to notebook {args.notebook_id}")
        print(f"  File: {file_path}")
        await client.add_file_source(
            args.notebook_id,
            str(file_path),
            wait=not args.no_wait,
        )
        print("  Done.\n")
        _write_response(
            args.county,
            "_added_source",
            f"Added source: {file_path}\n",
            {
                "operation": "add-source",
                "notebook_id": args.notebook_id,
                "file": str(file_path),
                "county": args.county,
                "timestamp": _now_iso(),
            },
        )
        return 0
    finally:
        await client.close()


async def cmd_phase_a(args: argparse.Namespace) -> int:
    """Run NotebookLM research and import the returned sources."""
    try:
        file_path = _resolve_file(args.prompt_path)
    except FileNotFoundError:
        print(f"  ERROR: --prompt-path '{args.prompt_path}' not found.")
        return 1

    substitutions = _load_substitutions(args)
    substitutions.setdefault("BASIN_OR_COUNTY_NAME", args.county)
    query_text = _substitute(_extract_prompt(file_path), substitutions)

    client = BridgeNotebookLMClient()
    await client.open()
    try:
        print(
            f"\nPhase A — {args.mode.capitalize()} Research "
            f"on notebook {args.notebook_id}"
        )
        print(f"  Prompt: {file_path}")
        print("  Starting research...")
        research = await client.start_deep_research(
            args.notebook_id,
            query_text,
            mode=args.mode,
        )
        task_id = research.get("task_id")
        if not task_id:
            print("  ERROR: Research start returned no task_id. Aborting.")
            return 1

        print(f"  Task ID: {task_id}")
        print("  Polling (this can take several minutes)...")
        final = await client.wait_for_research(
            args.notebook_id,
            timeout_seconds=args.timeout,
            poll_interval=args.poll_interval,
        )
        if final.get("status") != "completed":
            print(
                "  ERROR: Research did not complete. "
                f"Final state: {final.get('status')}"
            )
            return 1

        sources = final.get("sources") or []
        to_import = sources[: args.max_sources]
        print(
            f"  Discovered {len(sources)} sources. "
            f"Importing {len(to_import)}."
        )
        await client.import_research_sources(
            args.notebook_id,
            task_id,
            to_import,
        )
        print("  Imported.\n")

        _write_response(
            args.county,
            "_phase_a_research_run",
            json.dumps(
                {
                    "task_id": task_id,
                    "sources_discovered": len(sources),
                    "sources_imported": len(to_import),
                    "prompt_path": str(file_path),
                },
                indent=2,
            ),
            {
                "phase": "A",
                "notebook_id": args.notebook_id,
                "county": args.county,
                "timestamp": _now_iso(),
            },
        )
        return 0
    finally:
        await client.close()


async def cmd_phase_b(args: argparse.Namespace) -> int:
    """Apply a configured persona to a notebook."""
    try:
        file_path = (
            _resolve_file(args.persona_path)
            if args.persona_path
            else QUERIES_DIR / "_persona.md"
        )
    except FileNotFoundError:
        print(f"  ERROR: --persona-path '{args.persona_path}' not found.")
        return 1

    persona_text = _substitute(
        _extract_prompt(file_path),
        _load_substitutions(args),
    )

    client = BridgeNotebookLMClient()
    await client.open()
    try:
        print(
            "\nPhase B — Configuring notebook persona "
            f"on notebook {args.notebook_id}"
        )
        print(f"  Persona: {file_path}")
        print(f"  Persona length: {len(persona_text)} chars")
        await client.configure_prompt(args.notebook_id, persona_text)
        print("  Persona applied.\n")
        _write_response(
            args.county,
            "_phase_b_persona_applied",
            f"Persona body (first 500 chars):\n\n{persona_text[:500]}...",
            {
                "phase": "B",
                "notebook_id": args.notebook_id,
                "county": args.county,
                "timestamp": _now_iso(),
                "persona_length": len(persona_text),
            },
        )
        return 0
    finally:
        await client.close()


async def cmd_query(args: argparse.Namespace) -> int:
    """Send one file-backed prompt and capture the response."""
    try:
        file_path = _resolve_file(args.prompt_path)
    except FileNotFoundError:
        print(f"  ERROR: --prompt-path '{args.prompt_path}' not found.")
        return 1

    query_text = _substitute(
        _extract_prompt(file_path),
        _load_substitutions(args),
    )
    output_name = args.output_name.removesuffix(".md")

    try:
        prompt_path = str(file_path.relative_to(_BRIDGE_DIR.parent))
    except ValueError:
        prompt_path = str(file_path)

    client = BridgeNotebookLMClient()
    await client.open()
    try:
        print(f"\nQuery — notebook {args.notebook_id}")
        print(f"  Prompt: {file_path.name}")
        print(f"  Prompt length: {len(query_text)} chars")
        answer = await client.query(args.notebook_id, query_text)
        print(f"  Response: {len(answer)} chars")
        _write_response(
            args.county,
            output_name,
            answer,
            {
                "phase": "query",
                "prompt_path": prompt_path,
                "notebook_id": args.notebook_id,
                "county": args.county,
                "timestamp": _now_iso(),
            },
        )
        print(f"  Saved to outputs/{args.county}/{output_name}.md\n")
        return 0
    finally:
        await client.close()


async def cmd_list_sources(args: argparse.Namespace) -> int:
    """Print notebook sources as JSON."""
    client = BridgeNotebookLMClient()
    await client.open()
    try:
        if client._client is None:
            print("  ERROR: client not open", file=sys.stderr)
            return 1

        sources = await client._client.sources.list(args.notebook_id)
        serializable = [
            {
                "id": getattr(source, "id", None),
                "title": getattr(source, "title", None),
                "url": getattr(source, "url", None),
            }
            for source in sources
        ]
        print(json.dumps(serializable, indent=2))
        return 0
    finally:
        await client.close()


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="notebooklm_bridge.runner",
        description="NotebookLM runtime used by the Fractal Framework wizard.",
    )
    commands = parser.add_subparsers(dest="cmd", required=True)

    command = commands.add_parser(
        "status",
        help="Print authentication and local budget status.",
    )
    command.add_argument(
        "--force",
        action="store_true",
        help="Bypass the authentication-status cache.",
    )

    command = commands.add_parser(
        "create-notebook",
        help="Create a notebook and print its ID.",
    )
    command.add_argument("--county", required=True)
    command.add_argument("--title", required=True)

    command = commands.add_parser(
        "add-source",
        help="Upload a local file as a notebook source.",
    )
    command.add_argument(
        "--county",
        required=True,
        help="Output slug used for the local audit trail.",
    )
    command.add_argument("--notebook-id", required=True)
    command.add_argument("--file", required=True)
    command.add_argument(
        "--no-wait",
        action="store_true",
        help="Return without waiting for source ingestion.",
    )

    command = commands.add_parser(
        "phase-a",
        help="Run Deep or Fast Research and import sources.",
    )
    command.add_argument("--county", required=True)
    command.add_argument("--notebook-id", required=True)
    command.add_argument(
        "--prompt-path",
        required=True,
        help="Research prompt path, absolute or relative to the bridge package.",
    )
    command.add_argument(
        "--mode",
        choices=["deep", "fast"],
        default="deep",
    )
    command.add_argument("--max-sources", type=int, default=10)
    command.add_argument("--timeout", type=float, default=900.0)
    command.add_argument("--poll-interval", type=float, default=15.0)
    command.add_argument(
        "--var",
        action="append",
        help="Runtime substitution in KEY=value form; repeat as needed.",
    )

    command = commands.add_parser(
        "phase-b",
        help="Configure a notebook persona.",
    )
    command.add_argument("--county", required=True)
    command.add_argument("--notebook-id", required=True)
    command.add_argument(
        "--persona-path",
        help="Persona path; defaults to queries/_persona.md.",
    )
    command.add_argument("--var", action="append")

    command = commands.add_parser(
        "query",
        help="Send one file-backed prompt and capture its response.",
    )
    command.add_argument("--county", required=True)
    command.add_argument("--notebook-id", required=True)
    command.add_argument("--prompt-path", required=True)
    command.add_argument("--output-name", required=True)
    command.add_argument("--var", action="append")

    command = commands.add_parser(
        "list-sources",
        help="List notebook sources as JSON.",
    )
    command.add_argument("--notebook-id", required=True)

    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    args = _parse_args(argv if argv is not None else sys.argv[1:])

    dispatch = {
        "status": cmd_status,
        "create-notebook": cmd_create_notebook,
        "add-source": cmd_add_source,
        "phase-a": cmd_phase_a,
        "phase-b": cmd_phase_b,
        "query": cmd_query,
        "list-sources": cmd_list_sources,
    }
    handler = dispatch.get(args.cmd)
    if handler is None:
        print(f"Unknown command: {args.cmd}", file=sys.stderr)
        return 2

    try:
        return asyncio.run(handler(args))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except Exception as error:
        logger.exception("Command failed")
        print(f"\nERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
