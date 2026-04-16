from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import admin, billing, health, music, video
from .settings import settings

app = FastAPI(title="wcs-api", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(health.router)
app.include_router(music.router)
app.include_router(video.router)
app.include_router(billing.router)
app.include_router(admin.router)
