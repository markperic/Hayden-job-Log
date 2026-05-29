"""Backend tests for Hayden Shared-Service Tracker."""
import os
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://job-log-settlement.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

USER_ANDREWS = "Hayden Andrews"
USER_BONE = "Hayden Bone"

CURRENT_MONTH = datetime.now(timezone.utc).strftime("%Y-%m")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def created_ids():
    ids = []
    yield ids
    # cleanup
    for i in ids:
        try:
            requests.delete(f"{API}/jobs/{i}", timeout=10)
        except Exception:
            pass


def _post_job(s, user, service, base, notes="TEST_"):
    r = s.post(f"{API}/jobs", json={"user": user, "service": service, "base_price": base, "notes": notes})
    return r


# --- /api/meta ---------------------------------------------------------------
def test_meta(s):
    r = s.get(f"{API}/meta")
    assert r.status_code == 200
    data = r.json()
    assert data["users"] == [USER_ANDREWS, USER_BONE]
    assert data["services"] == ["Picture Framing", "Large Format Printing", "Large Format Scanning"]
    assert data["service_owner"]["Picture Framing"] == USER_ANDREWS
    assert data["service_owner"]["Large Format Printing"] == USER_ANDREWS
    assert data["service_owner"]["Large Format Scanning"] == USER_BONE
    assert data["wholesale_discount"] == 20 or data["wholesale_discount"] == 20.0


# --- Pre-test: archive existing current month so we have a clean baseline ----
def test_zz_setup_clean(s):
    # Archive existing current month jobs so summary tests start clean
    r = s.post(f"{API}/jobs/archive?month={CURRENT_MONTH}")
    assert r.status_code == 200


# --- POST /api/jobs discount logic -------------------------------------------
def test_andrews_own_service_no_discount(s, created_ids):
    r = _post_job(s, USER_ANDREWS, "Picture Framing", 100)
    assert r.status_code == 200
    d = r.json()
    assert d["discount_percent"] == 0
    assert d["final_cost"] == 100.0
    assert "_id" not in d
    created_ids.append(d["id"])


def test_andrews_other_service_20(s, created_ids):
    r = _post_job(s, USER_ANDREWS, "Large Format Scanning", 100)
    assert r.status_code == 200
    d = r.json()
    assert d["discount_percent"] == 20
    assert d["final_cost"] == 80.0
    created_ids.append(d["id"])


def test_bone_other_service_20(s, created_ids):
    r = _post_job(s, USER_BONE, "Picture Framing", 250)
    assert r.status_code == 200
    d = r.json()
    assert d["discount_percent"] == 20
    assert d["final_cost"] == 200.0
    created_ids.append(d["id"])


def test_bone_own_service_no_discount(s, created_ids):
    r = _post_job(s, USER_BONE, "Large Format Scanning", 100)
    assert r.status_code == 200
    d = r.json()
    assert d["discount_percent"] == 0
    assert d["final_cost"] == 100.0
    created_ids.append(d["id"])


# --- Invalid inputs ----------------------------------------------------------
def test_invalid_base_price_zero(s):
    r = _post_job(s, USER_ANDREWS, "Picture Framing", 0)
    assert r.status_code == 422


def test_invalid_base_price_negative(s):
    r = _post_job(s, USER_ANDREWS, "Picture Framing", -5)
    assert r.status_code == 422


def test_invalid_user(s):
    r = s.post(f"{API}/jobs", json={"user": "Unknown", "service": "Picture Framing", "base_price": 50})
    assert r.status_code == 422


def test_invalid_service(s):
    r = s.post(f"{API}/jobs", json={"user": USER_ANDREWS, "service": "NotAService", "base_price": 50})
    assert r.status_code == 422


# --- GET /api/jobs -----------------------------------------------------------
def test_list_jobs_sorted_desc_excludes_archived(s, created_ids):
    r = s.get(f"{API}/jobs")
    assert r.status_code == 200
    jobs = r.json()
    # All our created ids must be present
    ids_in_list = {j["id"] for j in jobs}
    for cid in created_ids:
        assert cid in ids_in_list
    # check archived not included
    for j in jobs:
        assert j["archived"] is False
        assert "_id" not in j
    # check date desc sort
    dates = [j["date"] for j in jobs]
    assert dates == sorted(dates, reverse=True)


def test_list_jobs_filter_by_month(s, created_ids):
    r = s.get(f"{API}/jobs?month={CURRENT_MONTH}")
    assert r.status_code == 200
    for j in r.json():
        assert j["month"] == CURRENT_MONTH


# --- /api/summary ------------------------------------------------------------
def test_summary_current_month(s, created_ids):
    """Andrews total = 100 (framing) + 80 (scan) = 180; Bone total = 200 (framing) + 100 (scan) = 300."""
    r = s.get(f"{API}/summary?month={CURRENT_MONTH}")
    assert r.status_code == 200
    d = r.json()
    assert d["total_andrews"] == 180.0
    assert d["total_bone"] == 300.0
    assert d["net_balance"] == 120.0
    # Backend uses raw total_X (includes own-service) - bone total is higher → bone is debtor
    assert d["debtor"] == USER_BONE
    assert d["creditor"] == USER_ANDREWS
    assert d["job_count"] == 4


def test_summary_crafted_andrews_creditor(s):
    """Create only Andrews-scan (final 80) and Bone-framing (final 200) → Bone owes Andrews 120."""
    # archive everything first
    s.post(f"{API}/jobs/archive?month={CURRENT_MONTH}")
    a = _post_job(s, USER_ANDREWS, "Large Format Scanning", 100).json()
    b = _post_job(s, USER_BONE, "Picture Framing", 250).json()
    r = s.get(f"{API}/summary?month={CURRENT_MONTH}")
    d = r.json()
    assert d["total_andrews"] == 80.0
    assert d["total_bone"] == 200.0
    assert d["net_balance"] == 120.0
    assert d["debtor"] == USER_BONE
    assert d["creditor"] == USER_ANDREWS
    # cleanup
    s.delete(f"{API}/jobs/{a['id']}")
    s.delete(f"{API}/jobs/{b['id']}")


def test_summary_equal_totals(s):
    s.post(f"{API}/jobs/archive?month={CURRENT_MONTH}")
    a = _post_job(s, USER_ANDREWS, "Picture Framing", 50).json()  # final 50
    b = _post_job(s, USER_BONE, "Large Format Scanning", 50).json()  # final 50
    r = s.get(f"{API}/summary?month={CURRENT_MONTH}")
    d = r.json()
    assert d["total_andrews"] == 50.0
    assert d["total_bone"] == 50.0
    assert d["net_balance"] == 0
    assert d["debtor"] is None
    assert d["creditor"] is None
    s.delete(f"{API}/jobs/{a['id']}")
    s.delete(f"{API}/jobs/{b['id']}")


# --- DELETE /api/jobs --------------------------------------------------------
def test_delete_job_and_reflect(s):
    j = _post_job(s, USER_ANDREWS, "Picture Framing", 30).json()
    r = s.delete(f"{API}/jobs/{j['id']}")
    assert r.status_code == 200
    # verify removed from list
    jobs = s.get(f"{API}/jobs").json()
    assert all(x["id"] != j["id"] for x in jobs)


def test_delete_unknown_404(s):
    r = s.delete(f"{API}/jobs/non-existent-uuid-xyz")
    assert r.status_code == 404


# --- /api/jobs/archive -------------------------------------------------------
def test_archive_month(s):
    j = _post_job(s, USER_ANDREWS, "Picture Framing", 77).json()
    r = s.post(f"{API}/jobs/archive?month={CURRENT_MONTH}")
    assert r.status_code == 200
    # default GET should hide
    jobs = s.get(f"{API}/jobs").json()
    assert all(x["id"] != j["id"] for x in jobs)
    # include_archived shows it
    jobs_all = s.get(f"{API}/jobs?include_archived=true").json()
    ids = {x["id"] for x in jobs_all}
    assert j["id"] in ids
    # cleanup
    s.delete(f"{API}/jobs/{j['id']}")


# --- /api/months -------------------------------------------------------------
def test_months_includes_current_desc(s):
    r = s.get(f"{API}/months")
    assert r.status_code == 200
    d = r.json()
    assert CURRENT_MONTH in d["months"]
    assert d["current"] == CURRENT_MONTH
    assert d["months"] == sorted(d["months"], reverse=True)


# --- No _id leakage ----------------------------------------------------------
def test_no_objectid_leakage(s):
    j = _post_job(s, USER_ANDREWS, "Picture Framing", 10).json()
    assert "_id" not in j
    for x in s.get(f"{API}/jobs?include_archived=true").json():
        assert "_id" not in x
    s.delete(f"{API}/jobs/{j['id']}")
