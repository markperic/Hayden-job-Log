from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import csv
import io
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# --- Domain constants ---------------------------------------------------------

USER_ANDREWS = "Hayden Andrews"
USER_BONE = "Hayden Bone"
VALID_USERS = {USER_ANDREWS, USER_BONE}

SERVICE_FRAMING = "Picture Framing"
SERVICE_PRINTING = "Large Format Printing"
SERVICE_SCANNING = "Large Format Scanning"

# Owner mapping per spec
SERVICE_OWNER = {
    SERVICE_FRAMING: USER_ANDREWS,
    SERVICE_PRINTING: USER_ANDREWS,
    SERVICE_SCANNING: USER_BONE,
}

WHOLESALE_DISCOUNT = 20.0  # percent

UserType = Literal["Hayden Andrews", "Hayden Bone"]
ServiceType = Literal["Picture Framing", "Large Format Printing", "Large Format Scanning"]


def compute_discount(user: str, service: str) -> float:
    """Return discount percent: 20% when owner uses other's service, else 0%."""
    owner = SERVICE_OWNER.get(service)
    if owner is None:
        return 0.0
    return 0.0 if owner == user else WHOLESALE_DISCOUNT


def month_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


# --- Models -------------------------------------------------------------------

class JobCreate(BaseModel):
    user: UserType
    service: ServiceType
    base_price: float = Field(gt=0)
    notes: Optional[str] = ""

    @field_validator("notes")
    @classmethod
    def trim_notes(cls, v: Optional[str]) -> str:
        return (v or "").strip()


class Job(BaseModel):
    id: str
    user: str
    service: str
    base_price: float
    discount_percent: float
    final_cost: float
    notes: str
    date: str  # ISO 8601
    month: str  # YYYY-MM
    archived: bool = False


class Summary(BaseModel):
    month: str
    total_andrews: float
    total_bone: float
    net_balance: float  # absolute difference
    debtor: Optional[str] = None  # who owes
    creditor: Optional[str] = None  # who is owed
    job_count: int


# --- Helpers ------------------------------------------------------------------

def serialize_job(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "user": doc["user"],
        "service": doc["service"],
        "base_price": round(float(doc["base_price"]), 2),
        "discount_percent": round(float(doc["discount_percent"]), 2),
        "final_cost": round(float(doc["final_cost"]), 2),
        "notes": doc.get("notes", ""),
        "date": doc["date"],
        "month": doc["month"],
        "archived": bool(doc.get("archived", False)),
    }


# --- Routes -------------------------------------------------------------------

@api_router.get("/")
async def root():
    return {"message": "Hayden Shared-Service Tracker API"}


@api_router.get("/meta")
async def get_meta():
    """Return users, services, and ownership rules so the client renders correctly."""
    return {
        "users": [USER_ANDREWS, USER_BONE],
        "services": [SERVICE_FRAMING, SERVICE_PRINTING, SERVICE_SCANNING],
        "service_owner": SERVICE_OWNER,
        "wholesale_discount": WHOLESALE_DISCOUNT,
    }


@api_router.post("/jobs", response_model=Job)
async def create_job(payload: JobCreate):
    discount = compute_discount(payload.user, payload.service)
    final = round(payload.base_price * (1 - discount / 100.0), 2)
    now = datetime.now(timezone.utc)
    job_doc = {
        "id": str(uuid.uuid4()),
        "user": payload.user,
        "service": payload.service,
        "base_price": round(payload.base_price, 2),
        "discount_percent": discount,
        "final_cost": final,
        "notes": payload.notes,
        "date": now.isoformat(),
        "month": month_key(now),
        "archived": False,
    }
    await db.jobs.insert_one(job_doc.copy())
    return serialize_job(job_doc)


@api_router.get("/jobs", response_model=List[Job])
async def list_jobs(month: Optional[str] = None, include_archived: bool = False):
    """List jobs. If month is provided, filter to that month. By default, hide archived."""
    query: dict = {}
    if month:
        query["month"] = month
    if not include_archived:
        query["archived"] = False
    cursor = db.jobs.find(query, {"_id": 0}).sort("date", -1)
    docs = await cursor.to_list(length=2000)
    return [serialize_job(d) for d in docs]


@api_router.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    res = await db.jobs.delete_one({"id": job_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"ok": True, "deleted": job_id}


@api_router.get("/summary", response_model=Summary)
async def get_summary(month: Optional[str] = None, include_archived: bool = False):
    if month is None:
        month = month_key(datetime.now(timezone.utc))
    query = {"month": month}
    if not include_archived:
        query["archived"] = False
    cursor = db.jobs.find(query, {"_id": 0})
    docs = await cursor.to_list(length=5000)

    total_andrews = round(sum(d["final_cost"] for d in docs if d["user"] == USER_ANDREWS), 2)
    total_bone = round(sum(d["final_cost"] for d in docs if d["user"] == USER_BONE), 2)
    diff = round(total_andrews - total_bone, 2)
    if abs(diff) < 0.005:
        debtor = None
        creditor = None
        net = 0.0
    elif diff > 0:
        # Andrews spent more on Bone's services → Andrews owes Bone
        debtor = USER_ANDREWS
        creditor = USER_BONE
        net = abs(diff)
    else:
        debtor = USER_BONE
        creditor = USER_ANDREWS
        net = abs(diff)

    return Summary(
        month=month,
        total_andrews=total_andrews,
        total_bone=total_bone,
        net_balance=round(net, 2),
        debtor=debtor,
        creditor=creditor,
        job_count=len(docs),
    )


@api_router.get("/months")
async def list_months():
    """Distinct months that have jobs, sorted desc."""
    months = await db.jobs.distinct("month")
    months = sorted([m for m in months if m], reverse=True)
    current = month_key(datetime.now(timezone.utc))
    if current not in months:
        months.insert(0, current)
    return {"months": months, "current": current}


@api_router.get("/jobs/export")
async def export_jobs_csv(month: Optional[str] = None, include_archived: bool = True):
    """Export jobs as CSV. `month=YYYY-MM` filters; omit (or 'all') for all months.
    Archived jobs are included by default so monthly history downloads stay complete."""
    query: dict = {}
    if month and month.lower() != "all":
        query["month"] = month
    if not include_archived:
        query["archived"] = False

    cursor = db.jobs.find(query, {"_id": 0}).sort("date", 1)
    docs = await cursor.to_list(length=100000)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Date",
        "Month",
        "User",
        "Service",
        "Base Price",
        "Discount %",
        "Final Cost",
        "Job Name",
        "Archived",
        "ID",
    ])
    for d in docs:
        writer.writerow([
            d.get("date", ""),
            d.get("month", ""),
            d.get("user", ""),
            d.get("service", ""),
            f"{float(d.get('base_price', 0)):.2f}",
            f"{float(d.get('discount_percent', 0)):.2f}",
            f"{float(d.get('final_cost', 0)):.2f}",
            d.get("notes", ""),
            "yes" if d.get("archived") else "no",
            d.get("id", ""),
        ])

    filename_part = month if (month and month.lower() != "all") else "all"
    filename = f"hayden-tracker-{filename_part}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.post("/jobs/archive")
async def archive_month(month: Optional[str] = None):
    """Archive all jobs of the given month (default: current). Keeps history, removes from active ledger."""
    if month is None:
        month = month_key(datetime.now(timezone.utc))
    res = await db.jobs.update_many({"month": month, "archived": False}, {"$set": {"archived": True}})
    return {"ok": True, "month": month, "archived_count": res.modified_count}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
