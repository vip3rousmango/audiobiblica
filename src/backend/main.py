"""Main backend application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.backend.api.router import api_router
from src.backend.mcp.server import AudioBiblicaMCPServer


def create_app() -> FastAPI:
    """Create the FastAPI application."""
    app = FastAPI(
        title="AudioBiblica API",
        version="0.1.0",
        description="Audio equipment knowledge management system",
    )
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    app.include_router(api_router)
    
    return app


app = create_app()


@app.on_event("startup")
async def startup_event():
    """Initialize MCP server on startup."""
    global mcp_server
    mcp_server = AudioBiblicaMCPServer()


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up MCP server on shutdown."""
    global mcp_server
    mcp_server = None


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/api/v1/equipment")
async def list_equipment():
    """List all audio equipment."""
    return {"equipment": []}


@app.get("/api/v1/equipment/{equipment_id}")
async def get_equipment(equipment_id: str):
    """Get equipment details."""
    return {"equipment": {"id": equipment_id, "status": "not_found"}}


@app.post("/api/v1/equipment")
async def create_equipment():
    """Create new equipment entry."""
    return {"equipment": {"status": "created"}}


@app.post("/api/v1/equipment/{equipment_id}/manuals")
async def upload_manual(equipment_id: str):
    """Upload manual for equipment."""
    return {"manual": {"equipment_id": equipment_id, "status": "uploaded"}}


@app.get("/api/v1/equipment/{equipment_id}/manuals/{manual_id}")
async def get_manual(equipment_id: str, manual_id: str):
    """Get manual details."""
    return {"manual": {"equipment_id": equipment_id, "manual_id": manual_id}}


@app.delete("/api/v1/equipment/{equipment_id}/manuals/{manual_id}")
async def delete_manual(equipment_id: str, manual_id: str):
    """Delete manual."""
    return {"manual": {"equipment_id": equipment_id, "manual_id": manual_id, "status": "deleted"}}


@app.post("/api/v1/equipment/{equipment_id}/research")
async def research_equipment(equipment_id: str):
    """Research equipment on manufacturer sites."""
    return {"equipment_id": equipment_id, "status": "research_started"}


@app.post("/api/v1/mcp")
async def mcp_endpoint():
    """MCP endpoint for agent integration."""
    return {"mcp": {"status": "ready"}}
