.PHONY: setup build lint test-dev test-review

setup:
	python -m pip install --upgrade pip
	pip install -r requirements.txt

build:
	python -m compileall -q src

lint:
	python -m compileall -q src tests

test-dev:
	mkdir -p reports
	pytest tests/dev --junitxml=reports/dev.xml

test-review:
	mkdir -p reports
	pytest tests/review --junitxml=reports/review.xml