from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import admin, billing, health, music, shared, uploads, video
from .settings import settings

app = FastAPI(title="wcs-api", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    # X-Swingflow-View is sent by fetchSharedAnalysis so the backend
    # knows it's a real frontend load (not a Slackbot unfurl). Custom
    # request headers require explicit CORS allow-list entries or the
    # preflight fails and the browser reports "Failed to fetch".
    allow_headers=["Authorization", "Content-Type", "X-Swingflow-View"],
)

app.include_router(health.router)
app.include_router(music.router)
app.include_router(video.router)
app.include_router(uploads.router)
app.include_router(billing.router)
app.include_router(admin.router)
app.include_router(shared.router)
