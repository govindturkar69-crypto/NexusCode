from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Replace YOUR_PASSWORD with your actual postgres password
DATABASE_URL = "postgresql://postgres:Anshul%40123@localhost:5432/college_project_db"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()