from dataclasses import dataclass, field
from datetime import datetime

from app.core.errors import AppError


@dataclass(frozen=True)
class Person:
    identity: str
    username: str


@dataclass
class Relationships:
    followers: dict[str, str]
    following: dict[str, str]
    timestamps: dict[str, datetime] = field(default_factory=dict)

    def category(self, name: str) -> dict[str, str]:
        f, g = set(self.followers), set(self.following)
        keys = {
            "followers": f,
            "following": g,
            "mutual": f & g,
            "not_following_back": g - f,
            "fans": f - g,
        }.get(name)
        if keys is None:
            raise AppError("invalid_category", "Неизвестная категория")
        return {k: self.followers.get(k, self.following.get(k, "")) for k in keys}

    def summary(self) -> dict:
        mutual = len(set(self.followers) & set(self.following))
        return {
            "followers": len(self.followers),
            "following": len(self.following),
            "mutual": mutual,
            "not_following_back": len(self.following) - mutual,
            "fans": len(self.followers) - mutual,
            "mutual_rate": round(mutual / len(self.followers) * 100, 1) if self.followers else None,
        }


def compare(before: Relationships, after: Relationships) -> list[dict[str, str]]:
    events = []
    for relation in ("followers", "following"):
        a, b = getattr(before, relation), getattr(after, relation)
        for key in b.keys() - a.keys():
            events.append({"identity_key": key, "username": b[key], "relation": relation, "type": "added"})
        for key in a.keys() - b.keys():
            events.append({"identity_key": key, "username": a[key], "relation": relation, "type": "removed"})
    return sorted(events, key=lambda e: (e["username"], e["relation"], e["type"]))
