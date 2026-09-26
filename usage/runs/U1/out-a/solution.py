from typing import List

from sqlalchemy import ForeignKey, create_engine, select
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
    name: Mapped[str] = mapped_column()

    addresses: Mapped[List["Address"]] = relationship(back_populates="user")


class Address(Base):
    __tablename__ = "address"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column()
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))

    user: Mapped["User"] = relationship(back_populates="addresses")


engine = create_engine("sqlite://")
Base.metadata.create_all(engine)


def print_users(session: Session) -> None:
    stmt = select(User).options(selectinload(User.addresses)).order_by(User.id)
    for user in session.execute(stmt).scalars():
        emails = ", ".join(sorted(a.email for a in user.addresses))
        print(f"{user.name}: {emails}")


with Session(engine) as session:
    spongebob = User(name="spongebob")
    spongebob.addresses.append(Address(email="spongebob@sqlalchemy.org"))
    spongebob.addresses.append(Address(email="spongebob@squarepants.com"))
    session.add(spongebob)
    session.commit()
    spongebob_id = spongebob.id

with Session(engine) as session:
    print_users(session)

    user = session.get(User, spongebob_id)
    squarepants = next(a for a in user.addresses if "squarepants" in a.email)
    session.delete(squarepants)
    session.commit()

    print_users(session)
