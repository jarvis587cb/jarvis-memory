.PHONY: setup run stop logs test clean skill

all: setup run

setup: models/gte-small.gtemodel

models/gte-small.gtemodel:
	@echo "Setting up Python environment and downloading model..."
	python3 -m venv .venv
	.venv/bin/pip install numpy safetensors requests
	.venv/bin/python download_model.py
	curl -s -O https://raw.githubusercontent.com/rcarmo/gte-go/main/convert_model.py
	.venv/bin/python convert_model.py models/gte-small models/gte-small.gtemodel

run:
	@echo "Building Admin Panel..."
	cd internal/admin && npm install && npm run build
	@echo "Starting Jarvis Memory..."
	docker compose up -d --build

stop:
	@echo "Stopping Jarvis Memory..."
	docker compose down

logs:
	docker compose logs -f

test:
	@echo "Testing connection..."
	./scripts/jarvis-memory.sh test

clean:
	@echo "Cleaning up..."
	rm -rf .venv convert_model.py
	# Optional: remove models if you want a complete clean
	# rm -rf models 

skill:
	@echo "Installing Jarvis Memory skill to OpenClaw workspace..."
	mkdir -p ~/.openclaw/workspace/skills/jarvis-memory
	cp SKILL.md ~/.openclaw/workspace/skills/jarvis-memory/
	cp -r scripts hooks ~/.openclaw/workspace/skills/jarvis-memory/
	@echo "Skill installed successfully."

