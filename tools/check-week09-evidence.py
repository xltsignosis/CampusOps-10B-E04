"""Read-only schema/SHA validation; tag validation is deliberately left to final delivery."""
from pathlib import Path
import json
import sys
from course_public_evaluator import git_sha, validate_report, validate_engineering, validate_individual

repo = Path(__file__).resolve().parent.parent
sha = git_sha(repo)
results = []
for name in ("fault-injection.json", "retry-metrics.json", "provider-execution.json", "regression.json", "validation.json"):
    path = repo / "reports" / "week-09" / name
    valid, detail = validate_report(repo, path, 9, sha)
    if valid:
        data = json.loads(path.read_text(encoding="utf-8"))
        valid = data.get("status") == "pass" and all(item["status"] == "pass" for item in data["checks"])
    results.append((name, valid, detail))
for name in ("engineering.json", "individual.json"):
    path = repo / "evidence" / "week-09" / name
    valid, detail = validate_engineering(repo, path, 9, sha) if name == "engineering.json" else validate_individual(path, 9)
    results.append((name, valid, detail))
for name, valid, detail in results:
    print(f"{'PASS' if valid else 'FAIL'} {name}: {detail}")
print("No tag created or validated; make evidence-week-09 remains a final delivery step.")
sys.exit(0 if all(valid for _, valid, _ in results) else 1)
