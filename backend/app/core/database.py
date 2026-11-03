from urllib.parse import unquote

from sqlalchemy import create_engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import Settings, settings


def build_database_url(config: Settings):
    """
    Two ways to configure the database:
    1. DATABASE_URL (what Render provides) - SSL is required unless the URL
       already sets its own sslmode.
    2. Individual DB_* variables - DB_PASSWORD has no default and must be set.
       DB_SSLMODE is optional (e.g. "require").
    """
    if config.database_url:
        database_url = config.database_url
        # Render and Heroku hand out "postgres://", which SQLAlchemy 2 rejects
        if database_url.startswith("postgres://"):
            database_url = "postgresql://" + database_url[len("postgres://"):]
        url = make_url(database_url)
        if url.get_backend_name() == "postgresql" and "sslmode" not in url.query:
            url = url.update_query_dict({"sslmode": "require"})
        return url

    if not config.db_password:
        raise RuntimeError(
            "Database is not configured. Set DATABASE_URL, or set DB_PASSWORD "
            "(plus DB_HOST, DB_PORT, DB_NAME, DB_USER if they differ from the local defaults)."
        )

    query = {"sslmode": config.db_sslmode} if config.db_sslmode else {}

    # Older deployments pasted DB_PASSWORD straight into a URL string, so
    # existing values may be percent-encoded (e.g. "%40" for "@"). Decode once
    # so those keep working; URL.create re-escapes it correctly.
    return URL.create(
        "postgresql",
        username=config.db_user,
        password=unquote(config.db_password),
        host=config.db_host,
        port=config.db_port,
        database=config.db_name,
        query=query,
    )


engine = create_engine(build_database_url(settings), pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
