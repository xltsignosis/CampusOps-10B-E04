ifeq ($(OS),Windows_NT)
PYTHON ?= python
else
PYTHON ?= python3
endif
NPM ?= npm

.PHONY: setup verify feedback run run-backend package
.PHONY: verify-week-08

setup:
	$(NPM) ci

verify:
	$(NPM) run typecheck
	$(NPM) run lint
	$(NPM) run test:smoke

feedback: verify
	$(NPM) run audit:ci
	$(NPM) run bundle:release

run:
	$(NPM) run start

run-backend:
	$(NPM) run backend

package:
	$(NPM) run package:android

verify-week-%:
	$(PYTHON) tools/course_public_evaluator.py --week $* --mode verify --execute-toolchain

verify-week-08:
	$(PYTHON) tools/course_public_evaluator.py --week 8 --mode verify --execute-toolchain
	$(NPM) run test:week08

public-test-week-%:
	$(PYTHON) tools/course_public_evaluator.py --week $* --mode public --execute-toolchain

evidence-week-%:
	$(PYTHON) tools/course_public_evaluator.py --week $* --mode evidence
