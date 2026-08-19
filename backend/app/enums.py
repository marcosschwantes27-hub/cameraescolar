from enum import StrEnum


class UserRole(StrEnum):
    ADMIN = "admin"
    COORDINATOR = "coordinator"
    VIEWER = "viewer"


class Shift(StrEnum):
    MORNING = "Manhã"
    AFTERNOON = "Tarde"
    EVENING = "Noite"


class StudentStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class FaceEnrollmentStatus(StrEnum):
    NOT_ENROLLED = "not_enrolled"
    ENROLLED = "enrolled"
    REVIEW_NEEDED = "review_needed"


class EnrollmentPose(StrEnum):
    FRONT = "front"
    LEFT = "left"
    RIGHT = "right"
    UP = "up"
    DOWN = "down"


class OccurrenceType(StrEnum):
    LATE_ARRIVAL = "late_arrival"
    EARLY_DEPARTURE = "early_departure"
    SCHOOL_RECORD = "school_record"
    MEETING_MINUTES = "meeting_minutes"
    WARNING = "warning"


class IdentificationSource(StrEnum):
    MANUAL = "manual"
    FACIAL = "facial"


class OccurrenceStatus(StrEnum):
    ACTIVE = "active"
    CANCELLED = "cancelled"
