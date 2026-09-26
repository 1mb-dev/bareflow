"""One-to-many User/Address demo, SQLAlchemy 2.0 ORM, in-memory SQLite.

Mapping style (DeclarativeBase / Mapped / mapped_column), the
relationship.back_populates pairing, appending Address objects to
User.addresses, and the selectinload() query all follow the SQLAlchemy 2.0
Unified Tutorial section "Working with ORM Related Objects" (Persisting and
Loading Relationships; Loader Strategies / Selectin Load). Engine/session
setup and Session.get()/Session.delete() are not shown in that excerpt and
come from general SQLAlchemy 2.0 knowledge -- see the accompanying report.
"""

from typing import List

from sqlalchemy import ForeignKey, String, create_engine, select
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    selectinload,
)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "user_account"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(30))

    addresses: Mapped[List["Address"]] = relationship(back_populates="user")


class Address(Base):
    __tablename__ = "address"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255))
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))

    user: Mapped["User"] = relationship(back_populates="addresses")


def print_all_users(session: Session) -> None:
    stmt = select(User).options(selectinload(User.addresses)).order_by(User.id)
    for user in session.execute(stmt).scalars():
        emails = ", ".join(sorted(a.email for a in user.addresses))
        print(f"{user.name}: {emails}")


engine = create_engine("sqlite://")
Base.metadata.create_all(engine)

# Create spongebob with two addresses by appending to the collection, then commit.
with Session(engine) as session:
    u1 = User(name="spongebob")
    u1.addresses.append(Address(email="spongebob@sqlalchemy.org"))
    u1.addresses.append(Address(email="spongebob@squarepants.com"))
    session.add(u1)
    session.commit()
    spongebob_id = u1.id

# New session: eager-load all users with their addresses and print them.
with Session(engine) as session:
    print_all_users(session)

    user = session.get(User, spongebob_id)
    doomed = next(a for a in user.addresses if "squarepants" in a.email)
    session.delete(doomed)
    session.commit()

    print_all_users(session)
