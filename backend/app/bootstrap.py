import argparse
import getpass
from datetime import UTC, datetime

from sqlalchemy import select

from app.database import SessionLocal
from app.enums import Shift, UserRole
from app.models import Classroom, School, User
from app.security import hash_password


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cria a primeira escola e o usuário administrador")
    parser.add_argument("--school-name", required=True)
    parser.add_argument("--school-code", required=True)
    parser.add_argument("--admin-name", required=True)
    parser.add_argument("--admin-email", required=True)
    parser.add_argument("--classroom", default="1º A")
    parser.add_argument("--shift", choices=[shift.value for shift in Shift], default=Shift.MORNING)
    parser.add_argument("--academic-year", type=int, default=datetime.now(UTC).year)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    password = getpass.getpass("Senha do administrador: ")
    confirmation = getpass.getpass("Confirme a senha: ")
    if password != confirmation:
        raise SystemExit("As senhas não conferem")
    if len(password) < 12:
        raise SystemExit("A senha deve ter pelo menos 12 caracteres")

    school_code = args.school_code.strip().upper()
    email = args.admin_email.strip().casefold()
    with SessionLocal.begin() as session:
        if session.scalar(select(School).where(School.code == school_code)) is not None:
            raise SystemExit("Já existe uma escola com esse código")

        school = School(name=args.school_name.strip(), code=school_code)
        session.add(school)
        session.flush()
        session.add_all(
            [
                User(
                    school_id=school.id,
                    email=email,
                    full_name=args.admin_name.strip(),
                    password_hash=hash_password(password),
                    role=UserRole.ADMIN.value,
                ),
                Classroom(
                    school_id=school.id,
                    name=args.classroom.strip(),
                    academic_year=args.academic_year,
                    shift=args.shift,
                ),
            ]
        )

    print(f"Escola {school_code} e administrador {email} criados com sucesso.")


if __name__ == "__main__":
    main()
