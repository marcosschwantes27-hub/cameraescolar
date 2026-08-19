import re
import unicodedata


def normalize_search_text(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    without_accents = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    return re.sub(r"\s+", " ", without_accents.casefold()).strip()


def student_search_text(*, name: str, preferred_name: str | None, enrollment_code: str) -> str:
    return normalize_search_text(f"{name} {preferred_name or ''} {enrollment_code}")
