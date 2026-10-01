"""What "research this device properly" means, per kind of device.

A preamp and a monitor do not want the same questions asked of them, and a fixed list of buttons is
why the old research screen felt like a scraper rather than a colleague. This module is the scaffold:
for each category, the steps a run performs, which tool serves each one, and which key — if any —
unlocks it.

Two properties matter and are tested. Every step names a tool that exists, so a plan can never ask for
something the app cannot do. And every plan keeps a **keyless subset**, because the app has to be
useful to somebody who has brought no keys at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

#: Which column of the coverage matrix a step fills. Used to answer "what is missing across my
#: whole studio", which is the question a list of devices cannot answer.
DIMENSIONS = (
    "manual",
    "specs",
    "connections",
    "sources",
    "settings",
    "compatibility",
)


@dataclass(frozen=True)
class ResearchStep:
    """One thing a run tries to establish about one device."""

    id: str
    title: str
    #: The provider that serves this step — see services/providers.py.
    tool: str
    #: What the step is trying to find out, in the words of the person using the app.
    question: str
    dimension: str
    #: A provider whose key unlocks this step, or ``None`` when it always runs. A step
    #: whose tool is a provider id is unlocked exactly when that provider is configured.
    needs_key: Optional[str] = None


#: Steps every device gets, whatever it is.
_BASE: tuple[ResearchStep, ...] = (
    ResearchStep(
        id="manual",
        title="The manual",
        tool="manual_text",
        question="Is the official manual here, and does it say anything we do not know yet?",
        dimension="manual",
    ),
    ResearchStep(
        id="manufacturer_specs",
        title="Manufacturer specifications",
        tool="page_reader",
        question="What does the maker publish about this device?",
        dimension="specs",
    ),
    ResearchStep(
        id="sources",
        title="Reviews and write-ups",
        tool="web_search",
        question="What do people who own one say about it?",
        dimension="sources",
        needs_key="web_search",
    ),
)

#: Steps that only make sense for a kind of device, grouped by category.
_SCAFFOLDS: dict[str, tuple[ResearchStep, ...]] = {
    "Microphone": (
        ResearchStep(
            id="polar_pattern",
            title="Polar pattern",
            tool="easyschematic_templates",
            question="Which directions does it hear, and does that change with a switch?",
            dimension="specs",
        ),
        ResearchStep(
            id="phantom",
            title="Phantom power",
            tool="manual_text",
            question="Does it need 48 V, and would phantom hurt it?",
            dimension="connections",
        ),
        ResearchStep(
            id="impedance",
            title="Impedance and level",
            tool="manual_text",
            question="What impedance does it want to see, and how hot is its output?",
            dimension="connections",
        ),
        ResearchStep(
            id="spl",
            title="Maximum SPL",
            tool="manual_text",
            question="How loud a source can it take before it distorts?",
            dimension="specs",
        ),
        ResearchStep(
            id="demos",
            title="How it sounds",
            tool="youtube",
            question="What does it sound like on the sources this studio records?",
            dimension="sources",
            needs_key="youtube",
        ),
    ),
    "Console": (
        ResearchStep(
            id="channel_count",
            title="Channel count and bus structure",
            tool="manual_text",
            question="How many inputs, how many groups, and what can be routed where?",
            dimension="connections",
        ),
        ResearchStep(
            id="phantom_per_channel",
            title="Phantom per channel",
            tool="manual_text",
            question="Which inputs can supply 48 V, and is it switchable per channel or in blocks?",
            dimension="connections",
        ),
        ResearchStep(
            id="recall",
            title="Recall notes",
            tool="catalog",
            question="What settings are worth writing down so a session can be resumed?",
            dimension="settings",
        ),
    ),
    "Outboard": (
        ResearchStep(
            id="gain_range",
            title="Gain and range",
            tool="manual_text",
            question="How much gain does it offer, and where does it start to colour?",
            dimension="specs",
        ),
        ResearchStep(
            id="phantom_per_channel",
            title="Phantom power",
            tool="manual_text",
            question="Does it supply 48 V, and on which inputs?",
            dimension="connections",
        ),
        ResearchStep(
            id="transformer",
            title="Transformer or transformerless",
            tool="manual_text",
            question="Is there iron in the signal path, and does it want a load?",
            dimension="specs",
        ),
        ResearchStep(
            id="signal_role",
            title="Where it belongs in the chain",
            tool="catalog",
            question="What role does this play — tracking, bus, mastering — and in what order?",
            dimension="compatibility",
        ),
        ResearchStep(
            id="recall",
            title="Recall sheet",
            tool="catalog",
            question="Which settings are worth recording for next time?",
            dimension="settings",
        ),
    ),
    "Interface": (
        ResearchStep(
            id="channel_counts",
            title="Inputs and outputs",
            tool="easyschematic_templates",
            question="How many of each, and in what form?",
            dimension="connections",
        ),
        ResearchStep(
            id="connectors",
            title="Connector inventory",
            tool="easyschematic_templates",
            question="XLR, TRS, ADAT, S/PDIF, word clock — what is actually on the back?",
            dimension="connections",
        ),
        ResearchStep(
            id="clock",
            title="Clock source",
            tool="manual_text",
            question="Can it be the clock master, and what does it do as a slave?",
            dimension="connections",
        ),
        ResearchStep(
            id="software",
            title="Drivers and companion software",
            tool="page_reader",
            question="What has to be installed, and is there a mixer app that changes the routing?",
            dimension="settings",
        ),
    ),
    "Monitor": (
        ResearchStep(
            id="drivers",
            title="Driver complement",
            tool="easyschematic_templates",
            question="What drivers does it use, and how big?",
            dimension="specs",
        ),
        ResearchStep(
            id="amplifier",
            title="Amplification",
            tool="manual_text",
            question="Is it powered, and what class of amplifier drives it?",
            dimension="specs",
        ),
        ResearchStep(
            id="response",
            title="Frequency response",
            tool="manual_text",
            question="How low and how high does it actually go, and at what tolerance?",
            dimension="specs",
        ),
        ResearchStep(
            id="placement",
            title="Placement",
            tool="page_reader",
            question="Where should it sit relative to walls, and does it need a sub?",
            dimension="compatibility",
        ),
        ResearchStep(
            id="ports",
            title="Connections",
            tool="easyschematic_templates",
            question="What input does it take, and what cable goes to it?",
            dimension="connections",
        ),
    ),
    "Instrument": (
        ResearchStep(
            id="power",
            title="Power",
            tool="manual_text",
            question="What does it need to run — phantom, battery, an adapter?",
            dimension="connections",
        ),
        ResearchStep(
            id="impedance",
            title="Impedance and level",
            tool="manual_text",
            question="Which input does it belong in, and does it want a DI?",
            dimension="connections",
        ),
        ResearchStep(
            id="chain",
            title="Chain position",
            tool="catalog",
            question="Where does it sit relative to pedals, amp and interface?",
            dimension="compatibility",
        ),
    ),
    "Other": (),
}

#: Research that applies to a device whose category we do not know.
_UNKNOWN_EXTRA: tuple[ResearchStep, ...] = (
    ResearchStep(
        id="identity",
        title="What this device is",
        tool="web_search",
        question="What is it, who made it, and what is it for?",
        dimension="sources",
        needs_key="web_search",
    ),
)


def research_plan(category: str) -> list[ResearchStep]:
    """The steps a run performs for a kind of device.

    Unknown categories get the base plan plus a step that establishes what the device even is, rather
    than an empty list: a plan that does nothing is worse than a plan that asks.
    """
    specific = _SCAFFOLDS.get(category)
    if specific is None:
        return [*_BASE, *_UNKNOWN_EXTRA]
    return [*_BASE, *specific]


def plan_summary(category: str) -> dict:
    """A plan as data, for the interface and for the coverage matrix."""
    steps = research_plan(category)
    return {
        "category": category,
        "steps": [
            {
                "id": step.id,
                "title": step.title,
                "tool": step.tool,
                "question": step.question,
                "dimension": step.dimension,
                "needs_key": step.needs_key,
            }
            for step in steps
        ],
        "dimensions": sorted({step.dimension for step in steps}, key=DIMENSIONS.index),
    }


def coverage_for(category: str, *, covered: set[str], has_manual: bool = False) -> dict:
    """Which dimensions of a plan are known for one device, and which are gaps.

    A device with a manual counts as `manual` whatever else is missing — the manual is what makes the
    rest of it checkable — and a dimension counts as covered when a *reviewed* finding carries it.
    Pending findings deliberately do not count: nothing is known until somebody has looked, which is
    the whole point of the queue.
    """
    steps = research_plan(category)
    wanted = {step.dimension for step in steps}
    known = set(covered) | ({"manual"} if has_manual else set())
    missing = wanted - known
    return {
        "category": category,
        "dimensions": sorted(wanted, key=DIMENSIONS.index),
        "covered": sorted(wanted & known, key=DIMENSIONS.index),
        "missing": sorted(missing, key=DIMENSIONS.index),
        "complete": not missing,
        "steps": len(steps),
        "steps_remaining": sum(1 for step in steps if step.dimension in missing),
    }
