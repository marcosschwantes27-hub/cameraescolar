from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.local_bootstrap import ensure_local_school
from app.routers import auth, faces, health, school, students

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    ensure_local_school(settings)
    yield


app = FastAPI(
    title="Registro Escolar API",
    description="API para atendimento e registro de ocorrências escolares.",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(students.router)
app.include_router(school.router)
app.include_router(faces.router)
