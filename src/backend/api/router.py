"""Main API router for AudioBiblica backend."""

from fastapi import APIRouter
from src.backend.mcp.server import AudioBiblicaMCPServer

api_router = APIRouter()
