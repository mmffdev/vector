#!/usr/bin/env python3
"""
DRY RUN: <stories> skill 7-gate acceptance system
Simulates story planning, confidence assessment, and split logic
"""

import json
from dataclasses import dataclass
from typing import List, Optional
from enum import Enum

# ============================================================================
# Domain Models
# ============================================================================

class RiskLevel(Enum):
    LOW = "RISK-LOW"
    MED = "RISK-MED"
    HIGH = "RISK-HIGH"

class FibonacciEstimate(Enum):
    F0 = "EST-F0"   # spike
    F1 = "EST-F1"   # 1-2h
    F2 = "EST-F2"   # 1-2h
    F3 = "EST-F3"   # 2-4h
    F5 = "EST-F5"   # 4-8h
    F8 = "EST-F8"   # 1-2d
    F13 = "EST-F13" # 2-3d
    F21 = "EST-F21" # TOO BIG - SPLIT

    @staticmethod
    def from_string(s: str):
        for member in FibonacciEstimate:
            if member.value == s:
                return member
        raise ValueError(f"Unknown estimate: {s}")

class FeatureArea(Enum):
    POR = "POR"  # Portfolio
    LIB = "LIB"  # Library
    ITM = "ITM"  # Items
    DAT = "DAT"  # Data/Graphs
    UI = "UI"    # User Interface
    UX = "UX"    # User Experience
    SEC = "SEC"  # Security
    GOV = "GOV"  # Governance
    AUD = "AUD"  # Audit
    RED = "RED"  # Redundancy
    RUL = "RUL"  # Rules & Logic
    API = "API"  # API
    SQL = "SQL"  # Database
    DCR = "DCR"  # Docker
    ALG = "ALG"  # Algorithm
    DEV = "DEV"  # Developer

@dataclass
class AcceptanceCriterion:
    title: str
    description: str

    def is_verifiable(self) -> bool:
        """Check if criterion is verifiable (contains observable verb in first 4 words)"""
        verbs = [
            "returns", "shows", "renders", "accepts", "displays", "logs",
            "creates", "deletes", "updates", "marks", "sends", "writes",
            "emits", "clears", "inserts", "rejects", "redirects", "loads",
            "fetches", "saves", "removes", "sets", "exposes", "records",
            "produces", "triggers", "prevents", "skips", "finds",
        ]
        first_words = " ".join(self.description.lower().split()[:4])
        return any(v in first_words for v in verbs)

@dataclass
class UserStory:
    id: int
    title: str
    role: str
    action: str
    benefit: str
    context: str
    criteria: List[AcceptanceCriterion]
    feature_area: Optional[FeatureArea] = None
    estimate: Optional[FibonacciEstimate] = None
    risk: Optional[RiskLevel] = None

    def as_print(self):
        return f"{self.id:05d} — {self.title}"

# ============================================================================
# Confidence Assessment
# ============================================================================

class ConfidenceAssessment:
    def __init__(self, story: UserStory):
        self.story = story
        self.scores = {}
        self.failures = []

    def assess(self) -> float:
        """Run all confidence checks. Returns 0-100."""

        # Check 1: Title clarity
        if len(self.story.title) < 10:
            self.scores['title'] = 0
            self.failures.append("❌ Title too short (< 10 chars)")
        elif any(word in self.story.title.lower() for word in ["refactor", "improve", "fix", "support"]):
            self.scores['title'] = 60
            self.failures.append("⚠️ Title uses vague verb (refactor/improve/fix/support)")
        else:
            self.scores['title'] = 100

        # Check 2: Role is a real persona
        if self.story.role.lower() in ["system", "backend", "user", "api"]:
            self.scores['role'] = 0
            self.failures.append("❌ Role is not a persona (system/backend/user/api)")
        elif len(self.story.role) > 3:
            self.scores['role'] = 100
        else:
            self.scores['role'] = 50
            self.failures.append("⚠️ Role is unclear")

        # Check 3: Action is concrete
        if any(word in self.story.action.lower() for word in ["support", "enable", "handle"]):
            self.scores['action'] = 50
            self.failures.append("⚠️ Action is vague (support/enable/handle)")
        elif len(self.story.action) > 5:
            self.scores['action'] = 100
        else:
            self.scores['action'] = 30
            self.failures.append("❌ Action is not concrete")

        # Check 4: Benefit is observable
        if "better" in self.story.benefit.lower() or "cleaner" in self.story.benefit.lower():
            self.scores['benefit'] = 40
            self.failures.append("⚠️ Benefit is not observable (better/cleaner)")
        elif "so that" in self.story.benefit.lower():
            self.scores['benefit'] = 100
        else:
            self.scores['benefit'] = 20
            self.failures.append("❌ Benefit is unclear")

        # Check 5: Context paragraph
        if len(self.story.context) > 50:
            self.scores['context'] = 100
        else:
            self.scores['context'] = 30
            self.failures.append("⚠️ Context paragraph is too brief")

        # Check 6: Acceptance criteria
        if len(self.story.criteria) < 3:
            self.scores['criteria_count'] = 40
            self.failures.append(f"⚠️ Only {len(self.story.criteria)} criteria (need >= 3)")
        else:
            self.scores['criteria_count'] = 100

        # Check 7: Criteria are verifiable
        verifiable_count = sum(1 for c in self.story.criteria if c.is_verifiable())
        if verifiable_count == len(self.story.criteria):
            self.scores['criteria_verifiable'] = 100
        else:
            self.scores['criteria_verifiable'] = (verifiable_count / len(self.story.criteria)) * 100
            self.failures.append(f"⚠️ {len(self.story.criteria) - verifiable_count} criteria not verifiable")

        # Check 8: Feature area assigned
        if self.story.feature_area is None:
            self.scores['feature_area'] = 0
            self.failures.append("❌ Feature area not assigned")
        else:
            self.scores['feature_area'] = 100

        # Check 9: Estimate assigned
        if self.story.estimate is None:
            self.scores['estimate'] = 0
            self.failures.append("❌ Estimate not assigned")
        elif self.story.estimate == FibonacciEstimate.F21:
            self.scores['estimate'] = -100  # TRIGGER SPLIT
            self.failures.append("🔀 SPLIT REQUIRED: Estimate >= F21")
        else:
            self.scores['estimate'] = 100

        # Check 10: Risk assigned
        if self.story.risk is None:
            self.scores['risk'] = 0
            self.failures.append("❌ Risk level not assigned")
        else:
            self.scores['risk'] = 100

        # Calculate average (excluding -100 split trigger)
        valid_scores = [v for v in self.scores.values() if v >= 0]
        if not valid_scores:
            return 0
        average = sum(valid_scores) / len(valid_scores)
        return average

    def is_split_required(self) -> bool:
        """Check if story should be split (F21+ estimate)"""
        return self.story.estimate == FibonacciEstimate.F21

    def should_proceed(self) -> bool:
        """True if >= 85% confidence"""
        return self.assess() >= 85

# ============================================================================
# Test Scenarios
# ============================================================================

def test_scenario_1():
    """Good story: archive old layers (F3, RISK-MED, SQL)"""
    print("\n" + "="*80)
    print("SCENARIO 1: Archive old portfolio layers")
    print("="*80)

    story = UserStory(
        id=50,
        title="Backend: archive old portfolio layers before adopting new model",
        role="portfolio owner",
        action="reset a portfolio model state without deleting portfolio",
        benefit="so that I can start a different adoption flow",
        context="When adopting a new portfolio model, old subscription layers must be archived to prevent name-collision conflicts in the writeLayers function.",
        criteria=[
            AcceptanceCriterion("Layer archival", "API marks all layers with portfolio_model_id=(old) as archived before inserting new layers"),
            AcceptanceCriterion("Name uniqueness", "Skips archived layers during Pass 2 parent lookup so writeLayers finds the correct parent"),
            AcceptanceCriterion("Data consistency", "Database audit log shows (subscription_id, old_model_id, archived_at) record"),
        ],
        feature_area=FeatureArea.SQL,
        estimate=FibonacciEstimate.F3,
        risk=RiskLevel.MED
    )

    assess = ConfidenceAssessment(story)
    confidence = assess.assess()

    print(f"\nStory: {story.as_print()}")
    print(f"  Role: {story.role} | Action: {story.action}")
    print(f"  Feature: {story.feature_area.value} | EST: {story.estimate.value} | RISK: {story.risk.value}")
    print(f"\nConfidence Breakdown:")
    for key, score in assess.scores.items():
        bar = "█" * int(score/5) + "░" * (20 - int(score/5))
        print(f"  {key:20s}: {bar} {score:3.0f}%")

    print(f"\nOverall Confidence: {confidence:.1f}%")
    if assess.failures:
        print("Issues:")
        for failure in assess.failures:
            print(f"  {failure}")

    print(f"\n✅ PROCEED TO BACKLOG" if assess.should_proceed() else f"❌ REPLAN REQUIRED")
    return story if assess.should_proceed() else None

def test_scenario_2():
    """Good story: unadopt portfolio (F5, RISK-MED, API)"""
    print("\n" + "="*80)
    print("SCENARIO 2: Unadopt portfolio model from dev setup")
    print("="*80)

    story = UserStory(
        id=51,
        title="Backend: unadopt portfolio model from dev setup",
        role="dev gadmin",
        action="reset a subscription's portfolio model to null",
        benefit="so that I can start over with a different model",
        context="Dev gadmins need a way to undo portfolio adoption without deleting the portfolio. This endpoint clears all adoption state (layers, workflows, transitions, artifacts, terminology) and returns to pre-adoption state.",
        criteria=[
            AcceptanceCriterion("API endpoint", "Endpoint DELETE /api/portfolios/:id/model accepts gadmin bearer token and returns 200 with { model: null }"),
            AcceptanceCriterion("State cleanup", "Calling endpoint deletes all rows from portfolio_model_layers, portfolio_model_workflows, portfolio_model_transitions, portfolio_model_artifacts, portfolio_model_terminology for that portfolio"),
            AcceptanceCriterion("UI recovery", "Portfolio-model page reloads and shows 'No model adopted' with adoption wizard available again"),
        ],
        feature_area=FeatureArea.API,
        estimate=FibonacciEstimate.F5,
        risk=RiskLevel.MED
    )

    assess = ConfidenceAssessment(story)
    confidence = assess.assess()

    print(f"\nStory: {story.as_print()}")
    print(f"  Role: {story.role} | Action: {story.action}")
    print(f"  Feature: {story.feature_area.value} | EST: {story.estimate.value} | RISK: {story.risk.value}")
    print(f"\nConfidence Breakdown:")
    for key, score in assess.scores.items():
        bar = "█" * int(score/5) + "░" * (20 - int(score/5))
        print(f"  {key:20s}: {bar} {score:3.0f}%")

    print(f"\nOverall Confidence: {confidence:.1f}%")
    if assess.failures:
        print("Issues:")
        for failure in assess.failures:
            print(f"  {failure}")

    print(f"\n✅ PROCEED TO BACKLOG" if assess.should_proceed() else f"❌ REPLAN REQUIRED")
    return story if assess.should_proceed() else None

def test_scenario_3():
    """Good story: documentation (F2, RISK-LOW, DEV)"""
    print("\n" + "="*80)
    print("SCENARIO 3: Dev doc: portfolio model adoption action paths")
    print("="*80)

    story = UserStory(
        id=52,
        title="Dev doc: portfolio model adoption action paths",
        role="backend dev",
        action="document the complete adoption flow with API calls and DB touchpoints",
        benefit="so that future devs understand the end-to-end adoption sequence",
        context="The portfolio model adoption saga is complex with 7 steps and multiple DB tables. Internal documentation mapping API calls to DB state changes will help onboarding and debugging.",
        criteria=[
            AcceptanceCriterion("Action path doc", "Creates dev/planning/c_action_paths.md with step-by-step adoption flow"),
            AcceptanceCriterion("API references", "Lists all API endpoints called during adoption (stepValidate, stepLayers, stepWorkflows, etc.)"),
            AcceptanceCriterion("DB state map", "Document shows DB state changes per step and which tables are touched"),
        ],
        feature_area=FeatureArea.DEV,
        estimate=FibonacciEstimate.F2,
        risk=RiskLevel.LOW
    )

    assess = ConfidenceAssessment(story)
    confidence = assess.assess()

    print(f"\nStory: {story.as_print()}")
    print(f"  Role: {story.role} | Action: {story.action}")
    print(f"  Feature: {story.feature_area.value} | EST: {story.estimate.value} | RISK: {story.risk.value}")
    print(f"\nConfidence Breakdown:")
    for key, score in assess.scores.items():
        bar = "█" * int(score/5) + "░" * (20 - int(score/5))
        print(f"  {key:20s}: {bar} {score:3.0f}%")

    print(f"\nOverall Confidence: {confidence:.1f}%")
    if assess.failures:
        print("Issues:")
        for failure in assess.failures:
            print(f"  {failure}")

    print(f"\n✅ PROCEED TO BACKLOG" if assess.should_proceed() else f"❌ REPLAN REQUIRED")
    return story if assess.should_proceed() else None

def test_scenario_4():
    """Bad story: vague role + missing criteria (FAILS)"""
    print("\n" + "="*80)
    print("SCENARIO 4: Bad story — vague role, missing criteria")
    print("="*80)

    story = UserStory(
        id=53,
        title="Improve authentication system",
        role="system",  # ❌ BAD: "system" is not a persona
        action="improve the auth flow",  # ❌ BAD: vague
        benefit="so that auth is better",  # ❌ BAD: "better" is not observable
        context="The authentication system needs improvement.",  # ❌ BAD: too brief
        criteria=[
            AcceptanceCriterion("Login works", "Login page works"),  # ❌ BAD: not verifiable
        ],
        feature_area=FeatureArea.SEC,
        estimate=FibonacciEstimate.F13,  # Guessing at estimate, no confidence
        risk=None  # ❌ MISSING risk
    )

    assess = ConfidenceAssessment(story)
    confidence = assess.assess()

    print(f"\nStory: {story.as_print()}")
    print(f"  Role: {story.role} | Action: {story.action}")
    print(f"  Feature: {story.feature_area.value if story.feature_area else 'MISSING'} | EST: {story.estimate.value if story.estimate else 'MISSING'} | RISK: {story.risk.value if story.risk else 'MISSING'}")
    print(f"\nConfidence Breakdown:")
    for key, score in assess.scores.items():
        bar = "█" * int(score/5) + "░" * (20 - int(score/5))
        print(f"  {key:20s}: {bar} {score:3.0f}%")

    print(f"\nOverall Confidence: {confidence:.1f}%")
    if assess.failures:
        print("Issues:")
        for failure in assess.failures:
            print(f"  {failure}")

    print(f"\n✅ PROCEED TO BACKLOG" if assess.should_proceed() else f"❌ REPLAN REQUIRED — Do not create card")
    return story if assess.should_proceed() else None

def test_scenario_5():
    """Too big story: F21 estimate (AUTO-SPLIT)"""
    print("\n" + "="*80)
    print("SCENARIO 5: Too big story — F21 estimate triggers auto-split")
    print("="*80)

    story = UserStory(
        id=54,
        title="Implement entire library release channel with versioning and audience management",
        role="product owner",
        action="build complete library release infrastructure",
        benefit="so that we can manage MMFF library versions and releases",
        context="The library system needs a full release channel with severity levels, reconciler, and audience targeting.",
        criteria=[
            AcceptanceCriterion("Release schema", "Create library_releases table with version, severity, audience_ids"),
            AcceptanceCriterion("Reconciler", "Implement reconciler logic to sync upstream releases"),
            AcceptanceCriterion("Audience targeting", "Add audience_subscription_ids and audience_tier filtering"),
        ],
        feature_area=FeatureArea.LIB,
        estimate=FibonacciEstimate.F21,  # ❌ TOO BIG
        risk=RiskLevel.HIGH
    )

    assess = ConfidenceAssessment(story)
    confidence = assess.assess()

    print(f"\nStory: {story.as_print()}")
    print(f"  Role: {story.role} | Action: {story.action}")
    print(f"  Feature: {story.feature_area.value} | EST: {story.estimate.value} | RISK: {story.risk.value}")
    print(f"\nConfidence Breakdown:")
    for key, score in assess.scores.items():
        bar = "█" * int(max(0, score)/5) + "░" * (20 - int(max(0, score)/5))
        print(f"  {key:20s}: {bar} {score:3.0f}%")

    print(f"\nOverall Confidence: {confidence:.1f}%")
    print(f"\n🔀 AUTO-SPLIT TRIGGERED (EST >= F21)")
    print("\nProposed breakdown:")

    splits = [
        ("LIB0001", "Library: create release severity enum and gating logic", "F3", "MED"),
        ("LIB0002", "Library: implement release reconciler", "F5", "MED"),
        ("LIB0003", "Library: add audience targeting to release gates", "F5", "MED"),
        ("SQL0001", "Database: library_releases table + migrations", "F3", "MED"),
    ]

    for idx, (area, title, est, risk) in enumerate(splits, 1):
        print(f"  {idx}. {area}: {title} (EST: {est}, RISK: {risk})")

    print("\nApprove these 4 stories, or revise? [y/n]")
    return None  # Don't proceed; offer split

# ============================================================================
# Run All Scenarios
# ============================================================================

if __name__ == "__main__":
    print("\n")
    print("╔" + "="*78 + "╗")
    print("║" + " "*20 + "<STORIES> SKILL — DRY RUN TEST" + " "*28 + "║")
    print("║" + " "*20 + "7-Gate Acceptance System" + " "*32 + "║")
    print("╚" + "="*78 + "╝")

    passed = []
    failed = []
    split = []

    s1 = test_scenario_1()
    passed.append(s1) if s1 else failed.append("Scenario 1")

    s2 = test_scenario_2()
    passed.append(s2) if s2 else failed.append("Scenario 2")

    s3 = test_scenario_3()
    passed.append(s3) if s3 else failed.append("Scenario 3")

    test_scenario_4()
    failed.append("Scenario 4")

    test_scenario_5()
    split.append("Scenario 5")

    # Summary
    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)

    print(f"\n✅ PASSED (ready for backlog): {len(passed)}")
    for story in passed:
        if story:
            print(f"   {story.as_print()} | {story.feature_area.value} | {story.estimate.value} | {story.risk.value}")

    print(f"\n❌ FAILED (replan required): {len(failed)}")
    for scenario in failed:
        print(f"   {scenario}")

    print(f"\n🔀 SPLIT TRIGGERED: {len(split)}")
    for scenario in split:
        print(f"   {scenario} (>= F21, propose breakdown)")

    print("\n" + "="*80)
    print("DRY RUN COMPLETE")
    print("="*80 + "\n")
