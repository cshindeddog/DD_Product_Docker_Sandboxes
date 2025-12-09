from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import httpx

from ddtrace import patch_all
patch_all()

from database import init_db, get_items, insert_item

app = FastAPI()

init_db()

class Item(BaseModel):
    name: str
    value: int

@app.get("/")
async def root():
    return {"message": "Backend is running!"}

@app.post("/items")
async def create_item(item: Item):
    insert_item(item.name, item.value)
    return {"status": "inserted"}

@app.get("/data")
async def fetch_data():
    # 1️⃣ Database query
    db_items = get_items()

    # 2️⃣ External API call with error handling
    external_data = None
    external_error = None

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get("https://httpbin.org/get")
            resp.raise_for_status()
            external_data = resp.json()
    except Exception as e:
        # You’ll see the full stack trace in Datadog APM / logs if enabled
        external_error = str(e)

    return JSONResponse(
        {
            "database_items": db_items,
            "external_api_response": external_data,
            "external_api_error": external_error,
        }
    )

