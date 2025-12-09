from sqlalchemy import create_engine, text

# 👇 This MUST be Postgres now, not sqlite
DATABASE_URL = "postgresql+psycopg2://dduser:ddpass@db:5432/demo"

engine = create_engine(DATABASE_URL, future=True)

def init_db():
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS items (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                value INTEGER NOT NULL
            );
        """))

def get_items():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT id, name, value FROM items"))
        return [dict(row) for row in result.mappings().all()]

def insert_item(name: str, value: int):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO items (name, value) VALUES (:name, :value)"),
            {"name": name, "value": value},
        )

