"""
Seed a self-contained demo project for a walkthrough or screenshots.

SAFETY — this never runs by accident:
  * It refuses unless DEMO_SEED=1 is set (that env var is the confirmation).
  * It refuses to touch a production-looking database. The host is read from the
    app's own config. Known managed-host patterns (supabase, pooler, render,
    amazonaws/rds, azure, neon, ...) are always refused. Any non-local host also
    needs DEMO_SEED_ALLOW_REMOTE=1 as a second, conscious opt-in.
  * It always prints the plan first.

Usage (from the backend/ directory, in the backend venv):
    python scripts/seed_demo.py --plan        # print the plan, write nothing
    DEMO_SEED=1 python scripts/seed_demo.py   # create the demo data
    DEMO_SEED=1 python scripts/seed_demo.py --remove   # remove ONLY its own data

All demo data is tagged so --remove deletes exactly what this script created and
nothing else: the users below (and their project, which cascades to its tasks,
chat, activity and code files).
"""
import argparse
import os
import sys
from datetime import date, timedelta
from pathlib import Path

# Run from anywhere: make "app" importable
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.core.database import SessionLocal, build_database_url  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import (  # noqa: E402
    ActivityModel,
    CodeFileModel,
    MessageModel,
    ProjectMemberModel,
    ProjectModel,
    TaskModel,
    UserModel,
)

# --- What the demo contains (tagged so it can be removed cleanly) ------------

DEMO_PASSWORD = "demo-pass-1234"  # the same for every demo account, for a live walkthrough
DEMO_PROJECT_NAME = "NexusCode Demo — Weather CLI"

# username -> (display email, role in the demo project)
DEMO_USERS = {
    "demo_priya": ("priya@demo.nexuscode.local", "owner"),
    "demo_alex": ("alex@demo.nexuscode.local", "editor"),
    "demo_sam": ("sam@demo.nexuscode.local", "viewer"),
}

# A deliberately buggy Python file, for the AI-agent part of the demo: average()
# divides by len(numbers)+1, and parse_temps crashes on a blank line.
BUGGY_PY = '''\
"""Small helpers for the weather CLI. (Has a couple of bugs on purpose.)"""


def average(numbers):
    # BUG: should divide by len(numbers), not len(numbers) + 1
    total = 0
    for n in numbers:
        total += n
    return total / (len(numbers) + 1)


def parse_temps(lines):
    # BUG: a blank line becomes "" and float("") raises ValueError
    return [float(line.strip()) for line in lines]


def hottest(readings):
    return max(readings, key=lambda r: r["temp"])
'''

CODE_FILES = [
    (
        "README.md",
        "markdown",
        "# Weather CLI\n\nA tiny demo project. Reads temperature readings and "
        "reports the average and the hottest city.\n\nRun: `python src/main.py data/temps.txt`\n",
    ),
    (
        "src/main.py",
        "python",
        '''\
import sys

from weather import average, hottest, parse_temps


def main(path):
    with open(path) as f:
        temps = parse_temps(f.readlines())
    print(f"average: {average(temps):.1f}")
    cities = [{"city": "Pune", "temp": t} for t in temps]
    print(f"hottest: {hottest(cities)['city']}")


if __name__ == "__main__":
    main(sys.argv[1])
''',
    ),
    ("src/weather.py", "python", BUGGY_PY),
    ("data/temps.txt", "plaintext", "31.5\n28.0\n\n34.2\n"),
]

# (title, status, priority, assignee username or None, days-from-today due or None)
TASKS = [
    ("Set up the repo and CLI skeleton", "done", "high", "demo_priya", -3),
    ("Parse the temperature file", "done", "medium", "demo_alex", -1),
    ("Fix the average() off-by-one bug", "in_progress", "high", "demo_alex", 1),
    ("Handle blank lines in parse_temps", "todo", "high", "demo_priya", 2),
    ("Add a --city filter flag", "todo", "low", None, 5),
    ("Write README usage examples", "todo", "medium", "demo_sam", 4),
]

MESSAGES = [
    ("demo_priya", "Pushed the CLI skeleton — grab a task from the board."),
    ("demo_alex", "parse_temps works but it blows up on the blank line in temps.txt."),
    ("demo_sam", "Reading through it — the average looks a bit low to me?"),
    ("demo_priya", "Good eye. Let's have the agent take a look at weather.py."),
]

ACTIVITY = [
    ("demo_priya", "created project", DEMO_PROJECT_NAME),
    ("demo_priya", "added member", "demo_alex"),
    ("demo_priya", "added member", "demo_sam"),
    ("demo_alex", "moved task", "Parse the temperature file"),
]


# --- Safety guards -----------------------------------------------------------

# Hosts that must never be seeded, whatever else is set.
PRODUCTION_HOST_MARKERS = (
    "supabase", "pooler", "render.com", "amazonaws", "rds.", "azure",
    "neon.tech", "digitalocean", "gcp", "cloud.google",
)
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}


def db_host():
    url = build_database_url(settings)
    return (url.host or "").lower()


def refuse(message):
    print(f"REFUSED: {message}", file=sys.stderr)
    sys.exit(2)


def check_allowed_to_write():
    host = db_host()
    for marker in PRODUCTION_HOST_MARKERS:
        if marker in host:
            refuse(f"database host looks like production ('{marker}'). Not seeding.")
    is_local = host in LOCAL_HOSTS or host.endswith(".local") or host.endswith(".localhost")
    if not is_local and os.environ.get("DEMO_SEED_ALLOW_REMOTE") != "1":
        refuse(
            "database host is not local. If this really is a throwaway demo DB, "
            "set DEMO_SEED_ALLOW_REMOTE=1 as well."
        )
    if os.environ.get("DEMO_SEED") != "1":
        refuse("set DEMO_SEED=1 to confirm. (Plan printed above; nothing was written.)")


# --- Plan / seed / remove ----------------------------------------------------

def print_plan(removing):
    host = db_host() or "(local socket)"
    verb = "REMOVE" if removing else "CREATE"
    print(f"Demo seed plan — would {verb} against DB host: {host}\n")
    if removing:
        print(f"  - project '{DEMO_PROJECT_NAME}' and everything under it")
        print(f"  - users: {', '.join(DEMO_USERS)}")
        print("  (a project cascade removes its tasks, chat, activity and code files)")
        return
    print(f"  users ({len(DEMO_USERS)}): " + ", ".join(f"{u} [{r}]" for u, (_, r) in DEMO_USERS.items()))
    print(f"  project: '{DEMO_PROJECT_NAME}'")
    print(f"  code files ({len(CODE_FILES)}): " + ", ".join(p for p, _, _ in CODE_FILES))
    print(f"  tasks: {len(TASKS)}   chat messages: {len(MESSAGES)}   activity: {len(ACTIVITY)}")
    print(f"  every account's password: {DEMO_PASSWORD!r}")
    print("  (the buggy src/weather.py is there for the AI-agent part of the demo)")


def existing(db):
    users = db.query(UserModel).filter(UserModel.username.in_(DEMO_USERS)).all()
    project = db.query(ProjectModel).filter(ProjectModel.name == DEMO_PROJECT_NAME).first()
    return users, project


def remove(db):
    users, project = existing(db)
    if project:
        db.delete(project)  # cascades tasks/messages/activity/code_files/members
    for user in users:
        db.delete(user)
    db.commit()
    print(f"Removed demo data ({'project + ' if project else ''}{len(users)} users).")


def seed(db):
    if any(existing(db)):
        refuse("demo data already exists. Run with --remove first.")

    users = {}
    for username, (email, _role) in DEMO_USERS.items():
        user = UserModel(
            username=username,
            email=email,
            email_verified=True,
            hashed_password=hash_password(DEMO_PASSWORD),
        )
        db.add(user)
        users[username] = user
    db.flush()  # assign ids

    owner = users["demo_priya"]
    project = ProjectModel(name=DEMO_PROJECT_NAME, description="A tiny weather CLI, for the demo.", owner_id=owner.id)
    db.add(project)
    db.flush()

    for username, (_email, role) in DEMO_USERS.items():
        db.add(ProjectMemberModel(project_id=project.id, user_id=users[username].id, role=role))

    for path, language, content in CODE_FILES:
        db.add(CodeFileModel(project_id=project.id, path=path, content=content, language=language))

    for position, (title, status, priority, assignee, due_offset) in enumerate(TASKS):
        db.add(TaskModel(
            project_id=project.id,
            title=title,
            status=status,
            priority=priority,
            position=position,
            assignee_id=users[assignee].id if assignee else None,
            due_date=date.today() + timedelta(days=due_offset) if due_offset is not None else None,
        ))

    for username, content in MESSAGES:
        db.add(MessageModel(project_id=project.id, user_id=users[username].id, username=username, content=content))

    for username, action, target in ACTIVITY:
        db.add(ActivityModel(project_id=project.id, user_id=users[username].id, action=action, target=target))

    db.commit()
    print(f"Seeded '{DEMO_PROJECT_NAME}' (project {project.id}) with {len(DEMO_USERS)} users. "
          f"Sign in as any of {', '.join(DEMO_USERS)} / {DEMO_PASSWORD!r}.")


def main():
    parser = argparse.ArgumentParser(description="Seed or remove the demo project.")
    parser.add_argument("--plan", "--dry-run", action="store_true", dest="plan",
                        help="print the plan and exit without writing")
    parser.add_argument("--remove", action="store_true", help="remove the demo data this script created")
    args = parser.parse_args()

    print_plan(removing=args.remove)
    if args.plan:
        return

    check_allowed_to_write()
    db = SessionLocal()
    try:
        if args.remove:
            remove(db)
        else:
            seed(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
