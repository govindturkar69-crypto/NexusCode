from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.rate_limit import LOGIN_LIMIT, SIGNUP_LIMIT, limiter
from app.core.security import hash_password, session_token_for, verify_password
from app.models import UserModel
from app.routers.password import send_verification_quietly
from app.schemas.auth import MeOut, SignupResponse, Token, UserCreate

router = APIRouter(tags=["auth"])


@router.post("/signup", status_code=201, response_model=SignupResponse)
@limiter.limit(SIGNUP_LIMIT)
def signup(request: Request, user: UserCreate, background: BackgroundTasks, db: Session = Depends(get_db)):
    existing_user = db.query(UserModel).filter(UserModel.username == user.username).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="Username already taken")
    if user.email and db.query(UserModel.id).filter(UserModel.email == user.email).first():
        raise HTTPException(status_code=409, detail="That email address is already used by another account.")

    new_user = UserModel(username=user.username, hashed_password=hash_password(user.password), email=user.email)
    db.add(new_user)
    try:
        db.commit()
    except IntegrityError:
        # Two sign-ups for the same name or email at the same moment: the unique index wins
        db.rollback()
        raise HTTPException(status_code=409, detail="That username or email address is already taken") from None
    db.refresh(new_user)
    if new_user.email:
        background.add_task(send_verification_quietly, new_user.id)
    return {"message": "User created successfully", "username": new_user.username}


@router.post("/login", response_model=Token)
@limiter.limit(LOGIN_LIMIT)
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    db_user = db.query(UserModel).filter(UserModel.username == form_data.username).first()
    if not db_user or not verify_password(form_data.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    access_token = session_token_for(db_user)
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=MeOut)
def read_current_user(current_user: UserModel = Depends(get_current_user)):
    return {"id": current_user.id, "username": current_user.username, "is_admin": bool(current_user.is_admin)}
