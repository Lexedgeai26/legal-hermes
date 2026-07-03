"""LexEdge legal practice profile catalog and local SQLite persistence."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from hermes_cli.config import get_hermes_home

DB_FILENAME = "lexedge_practice.db"
SCHEMA_VERSION = 1

OPTION_CATEGORIES: Dict[str, List[str]] = {
    "position_titles": [
        "Partner",
        "Managing Partner",
        "Principal",
        "Associate",
        "Senior Associate",
        "Counsel",
        "General Counsel",
        "In-house Counsel",
        "Legal Consultant",
        "Company Secretary",
        "Paralegal",
    ],
    "professional_roles": [
        "Lawyer",
        "Solicitor",
        "Barrister",
        "Advocate",
        "Attorney",
        "General Counsel",
        "In-house Counsel",
        "Corporate Counsel",
        "Government Lawyer",
        "Public Prosecutor",
        "Judge",
        "Magistrate",
        "Arbitrator",
        "Mediator",
        "Legal Consultant",
        "Compliance Officer",
        "Company Secretary",
        "Paralegal",
        "Legal Researcher",
        "Law Student",
        "Academic",
        "Retired Legal Professional",
    ],
    "legal_systems": [
        "Common Law",
        "Civil Law",
        "Mixed Legal System",
        "Religious Law",
        "Customary Law",
        "Hybrid Legal System",
    ],
    "client_types": [
        "Individuals",
        "Families",
        "Startups",
        "Small Business",
        "Medium Business",
        "Large Enterprise",
        "Public Company",
        "Government",
        "Municipality",
        "NGO",
        "University",
        "Hospital",
        "Bank",
        "Insurance Company",
        "Technology Company",
        "Manufacturing Company",
        "Construction Company",
        "Energy Company",
        "Retail Company",
    ],
    "work_types": [
        "Litigation",
        "Advisory",
        "Transactional",
        "Drafting",
        "Compliance",
        "Legal Research",
        "Due Diligence",
        "Investigation",
        "Negotiation",
        "Arbitration",
        "Mediation",
        "Corporate Governance",
        "Company Secretarial",
        "Policy Advisory",
        "Government Practice",
    ],
    "court_types": [
        "Supreme Court",
        "Constitutional Court",
        "High Court",
        "Appeal Court",
        "Federal Court",
        "District Court",
        "County Court",
        "Magistrate Court",
        "Municipal Court",
        "Commercial Court",
        "Family Court",
        "Criminal Court",
        "Civil Court",
        "Labour Court",
        "Consumer Court",
        "Tax Court",
        "Administrative Tribunal",
        "Competition Tribunal",
        "Arbitration Tribunal",
    ],
    "drafting_styles": ["Formal", "Business Friendly", "Plain English", "Traditional Legal", "Court Style", "Academic", "Detailed", "Concise", "Neutral", "Aggressive"],
    "writing_preferences": ["Very Detailed", "Balanced", "Short", "Executive Summary", "Bullet Point Format"],
    "risk_preferences": ["Very Conservative", "Conservative", "Balanced", "Commercial", "Aggressive"],
    "citation_styles": ["Bluebook", "ALWD", "OSCOLA", "AGLC", "Canadian Guide", "McGill Guide", "Indian Neutral Citation", "Indian Supreme Court Citation", "APA", "Chicago", "MLA", "No Citation"],
    "languages": ["English", "French", "German", "Spanish", "Portuguese", "Italian", "Dutch", "Arabic", "Hindi", "Gujarati", "Punjabi", "Tamil", "Telugu", "Kannada", "Malayalam", "Marathi", "Bengali", "Urdu", "Chinese", "Japanese", "Korean", "Russian"],
    "time_zones": ["Asia/Kolkata", "UTC", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Dubai", "Asia/Singapore", "Australia/Melbourne"],
    "compliance_frameworks": ["GDPR", "UK GDPR", "EU AI Act", "DORA", "CCPA", "CPRA", "HIPAA", "ISO 27001", "ISO 42001", "SOC 2", "PCI DSS", "NIST", "India DPDP Act", "PIPEDA", "LGPD", "PDPA Singapore", "PDPA Thailand"],
    "notification_preferences": ["Court Updates", "Judgment Updates", "Legislation Updates", "Regulatory Changes", "Compliance Alerts", "Legal News", "Saved Search Alerts", "Weekly Digest", "Monthly Digest"],
}

GROUPS: Dict[str, Dict[str, List[str]]] = {
    "practice_areas": {
        "Corporate & Commercial": ["Corporate Law", "Commercial Law", "Company Law", "Mergers & Acquisitions", "Joint Ventures", "Venture Capital", "Private Equity", "Securities Law", "Capital Markets", "Banking Law", "Finance Law"],
        "Litigation": ["Civil Litigation", "Criminal Litigation", "Commercial Litigation", "Constitutional Litigation", "Public Interest Litigation", "Arbitration", "Mediation", "Alternative Dispute Resolution"],
        "Employment": ["Employment Law", "Labour Law", "Workplace Safety", "Employee Benefits"],
        "Property": ["Real Estate", "Construction", "Infrastructure", "Land Acquisition", "Property Development"],
        "Intellectual Property": ["Trademark", "Copyright", "Patent", "Design", "Trade Secrets"],
        "Technology": ["Information Technology", "Cyber Law", "Artificial Intelligence", "Data Protection", "Privacy", "Digital Assets", "Blockchain"],
        "Tax": ["Direct Tax", "Indirect Tax", "GST / VAT", "Customs", "International Tax"],
        "Regulatory": ["Compliance", "Competition Law", "Consumer Protection", "Financial Regulation", "Insurance", "Telecommunications", "Energy", "Mining", "Environmental Law"],
        "Family": ["Divorce", "Child Custody", "Adoption", "Probate", "Wills", "Trusts", "Estate Planning"],
        "Other": ["Immigration", "Maritime", "Aviation", "Healthcare", "Education", "Sports Law", "Entertainment Law", "Human Rights", "International Law"],
    },
    "document_types": {
        "Contracts": ["Employment Agreement", "NDA", "Service Agreement", "Vendor Agreement", "Lease Agreement", "Shareholders Agreement", "Partnership Agreement", "Joint Venture Agreement", "Distribution Agreement", "Licensing Agreement"],
        "Corporate": ["Board Resolution", "Company Incorporation", "Memorandum", "Articles of Association"],
        "Litigation": ["Plaint", "Written Statement", "Affidavit", "Petition", "Appeal", "Reply", "Rejoinder", "Written Submission"],
        "Advisory": ["Legal Opinion", "Due Diligence Report", "Risk Assessment", "Compliance Report"],
        "Property": ["Sale Deed", "Gift Deed", "Mortgage", "Power of Attorney"],
        "IP": ["Patent Filing", "Trademark Filing", "Copyright Filing"],
    },
}

JURISDICTIONS = [
    {"legal_system": "Common Law", "country": "India", "state": "Gujarat", "region": "Ahmedabad", "court_type": "High Court", "court": "Gujarat High Court"},
    {"legal_system": "Common Law", "country": "India", "state": "Delhi", "region": "New Delhi", "court_type": "High Court", "court": "Delhi High Court"},
    {"legal_system": "Common Law", "country": "India", "state": "Maharashtra", "region": "Mumbai", "court_type": "High Court", "court": "Bombay High Court"},
    {"legal_system": "Common Law", "country": "India", "state": "Karnataka", "region": "Bengaluru", "court_type": "High Court", "court": "Karnataka High Court"},
    {"legal_system": "Common Law", "country": "India", "state": "India", "region": "New Delhi", "court_type": "Supreme Court", "court": "Supreme Court of India"},
    {"legal_system": "Common Law", "country": "Australia", "state": "Victoria", "region": "Melbourne", "court_type": "Supreme Court", "court": "Supreme Court of Victoria"},
    {"legal_system": "Common Law", "country": "United States", "state": "California", "region": "Federal", "court_type": "District Court", "court": "U.S. District Court"},
    {"legal_system": "Civil Law", "country": "Germany", "state": "Bavaria", "region": "Munich", "court_type": "Regional Court", "court": "Munich Regional Court"},
    {"legal_system": "Civil Law", "country": "France", "state": "Ile-de-France", "region": "Paris", "court_type": "Appeal Court", "court": "Paris Court of Appeal"},
]


def db_path() -> Path:
    return get_hermes_home() / DB_FILENAME


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    ensure_schema(conn)
    seed_catalog(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS catalog_options (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          label TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          UNIQUE(category, label)
        );
        CREATE TABLE IF NOT EXISTS catalog_group_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          group_label TEXT NOT NULL,
          label TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          UNIQUE(category, group_label, label)
        );
        CREATE TABLE IF NOT EXISTS jurisdiction_catalog (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          legal_system TEXT NOT NULL,
          country TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT '',
          region TEXT NOT NULL DEFAULT '',
          court_type TEXT NOT NULL DEFAULT '',
          court TEXT NOT NULL DEFAULT '',
          bench TEXT NOT NULL DEFAULT '',
          UNIQUE(legal_system, country, state, region, court_type, court, bench)
        );
        CREATE TABLE IF NOT EXISTS practice_profiles (
          profile_name TEXT PRIMARY KEY,
          full_name TEXT NOT NULL DEFAULT '',
          display_name TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          mobile TEXT NOT NULL DEFAULT '',
          organisation TEXT NOT NULL DEFAULT '',
          position_title TEXT NOT NULL DEFAULT '',
          bar_registration_number TEXT NOT NULL DEFAULT '',
          years_experience INTEGER,
          primary_language TEXT NOT NULL DEFAULT '',
          time_zone TEXT NOT NULL DEFAULT '',
          legal_system TEXT NOT NULL DEFAULT '',
          drafting_style TEXT NOT NULL DEFAULT '',
          writing_preference TEXT NOT NULL DEFAULT '',
          risk_preference TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS practice_profile_values (
          profile_name TEXT NOT NULL,
          category TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY(profile_name, category, value),
          FOREIGN KEY(profile_name) REFERENCES practice_profiles(profile_name) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS practice_profile_jurisdictions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_name TEXT NOT NULL,
          legal_system TEXT NOT NULL,
          country TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT '',
          region TEXT NOT NULL DEFAULT '',
          court_type TEXT NOT NULL DEFAULT '',
          court TEXT NOT NULL DEFAULT '',
          bench TEXT NOT NULL DEFAULT '',
          is_primary INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY(profile_name) REFERENCES practice_profiles(profile_name) ON DELETE CASCADE
        );
        """
    )
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?)", (str(SCHEMA_VERSION),))
    conn.commit()


def seed_catalog(conn: sqlite3.Connection) -> None:
    for category, labels in OPTION_CATEGORIES.items():
        for index, label in enumerate(labels):
            conn.execute(
                "INSERT OR IGNORE INTO catalog_options(category, label, sort_order) VALUES(?, ?, ?)",
                (category, label, index),
            )
    for category, groups in GROUPS.items():
        order = 0
        for group, labels in groups.items():
            for label in labels:
                conn.execute(
                    "INSERT OR IGNORE INTO catalog_group_items(category, group_label, label, sort_order) VALUES(?, ?, ?, ?)",
                    (category, group, label, order),
                )
                order += 1
    for row in JURISDICTIONS:
        conn.execute(
            """
            INSERT OR IGNORE INTO jurisdiction_catalog(legal_system, country, state, region, court_type, court, bench)
            VALUES(?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["legal_system"],
                row["country"],
                row.get("state", ""),
                row.get("region", ""),
                row.get("court_type", ""),
                row.get("court", ""),
                row.get("bench", ""),
            ),
        )
    conn.commit()


def catalog_payload() -> Dict[str, Any]:
    with connect() as conn:
        options: Dict[str, List[str]] = {}
        for row in conn.execute("SELECT category, label FROM catalog_options ORDER BY category, sort_order, label"):
            options.setdefault(row["category"], []).append(row["label"])

        grouped: Dict[str, Dict[str, List[str]]] = {}
        for row in conn.execute("SELECT category, group_label, label FROM catalog_group_items ORDER BY category, sort_order, label"):
            grouped.setdefault(row["category"], {}).setdefault(row["group_label"], []).append(row["label"])

        jurisdictions = [dict(row) for row in conn.execute(
            "SELECT legal_system, country, state, region, court_type, court, bench FROM jurisdiction_catalog ORDER BY country, state, region, court_type, court"
        )]
    return {"options": options, "groups": grouped, "jurisdictions": jurisdictions}


def save_profile(profile_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    name = profile_name.strip()
    if not name:
        raise ValueError("profile_name is required")
    personal = payload.get("personal") if isinstance(payload.get("personal"), dict) else {}
    preferences = payload.get("preferences") if isinstance(payload.get("preferences"), dict) else {}
    with connect() as conn:
        conn.execute("BEGIN")
        conn.execute(
            """
            INSERT INTO practice_profiles(
              profile_name, full_name, display_name, email, mobile, organisation, position_title,
              bar_registration_number, years_experience, primary_language, time_zone, legal_system,
              drafting_style, writing_preference, risk_preference, payload_json, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(profile_name) DO UPDATE SET
              full_name=excluded.full_name, display_name=excluded.display_name, email=excluded.email,
              mobile=excluded.mobile, organisation=excluded.organisation, position_title=excluded.position_title,
              bar_registration_number=excluded.bar_registration_number, years_experience=excluded.years_experience,
              primary_language=excluded.primary_language, time_zone=excluded.time_zone, legal_system=excluded.legal_system,
              drafting_style=excluded.drafting_style, writing_preference=excluded.writing_preference,
              risk_preference=excluded.risk_preference, payload_json=excluded.payload_json, updated_at=CURRENT_TIMESTAMP
            """,
            (
                name,
                str(personal.get("full_name") or ""),
                str(personal.get("display_name") or ""),
                str(personal.get("email") or ""),
                str(personal.get("mobile") or ""),
                str(personal.get("organisation") or ""),
                str(personal.get("position_title") or ""),
                str(personal.get("bar_registration_number") or ""),
                personal.get("years_experience") if personal.get("years_experience") not in ("", None) else None,
                str(personal.get("primary_language") or ""),
                str(personal.get("time_zone") or ""),
                str(preferences.get("legal_system") or ""),
                str(preferences.get("drafting_style") or ""),
                str(preferences.get("writing_preference") or ""),
                str(preferences.get("risk_preference") or ""),
                json.dumps(payload, ensure_ascii=False, sort_keys=True),
            ),
        )
        conn.execute("DELETE FROM practice_profile_values WHERE profile_name=?", (name,))
        for category in (
            "professional_roles",
            "secondary_languages",
            "practice_areas",
            "client_types",
            "work_types",
            "court_types",
            "citation_styles",
            "compliance_frameworks",
            "document_types",
            "notification_preferences",
        ):
            values = payload.get(category) if isinstance(payload.get(category), list) else []
            for value in values:
                conn.execute(
                    "INSERT OR IGNORE INTO practice_profile_values(profile_name, category, value) VALUES(?, ?, ?)",
                    (name, category, str(value)),
                )
        conn.execute("DELETE FROM practice_profile_jurisdictions WHERE profile_name=?", (name,))
        jurisdictions = payload.get("jurisdictions") if isinstance(payload.get("jurisdictions"), list) else []
        for index, jurisdiction in enumerate(jurisdictions):
            if not isinstance(jurisdiction, dict):
                continue
            conn.execute(
                """
                INSERT INTO practice_profile_jurisdictions(profile_name, legal_system, country, state, region, court_type, court, bench, is_primary)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    name,
                    str(jurisdiction.get("legal_system") or ""),
                    str(jurisdiction.get("country") or ""),
                    str(jurisdiction.get("state") or ""),
                    str(jurisdiction.get("region") or ""),
                    str(jurisdiction.get("court_type") or ""),
                    str(jurisdiction.get("court") or ""),
                    str(jurisdiction.get("bench") or ""),
                    1 if jurisdiction.get("is_primary") or index == 0 else 0,
                ),
            )
        conn.commit()
    return {"ok": True, "profile_name": name, "path": str(db_path())}
