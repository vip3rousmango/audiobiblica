"""Main API router for AudioBiblica backend."""

from fastapi import APIRouter
from .mcp.server import mcp_app

api_router = APIRouter()
mcp_app = mcp_app