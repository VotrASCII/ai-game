PORT ?= 8260

.PHONY: serve-lan serve-tailscale help

help:
	@echo "make serve-lan        - serve on your local network (Wi-Fi/Ethernet), no Tailscale needed"
	@echo "make serve-tailscale  - serve over Tailscale with HTTPS (via tailscale serve)"
	@echo "PORT=xxxx make ...    - override the default port ($(PORT))"

serve-lan:
	@IP=$$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null); \
	if [ -z "$$IP" ]; then \
		echo "Could not detect a LAN IP on en0/en1. Is Wi-Fi/Ethernet connected?"; \
		exit 1; \
	fi; \
	echo "Serving on http://$$IP:$(PORT) (local network only)"; \
	python3 -m http.server $(PORT) --bind $$IP

serve-tailscale:
	@python3 -m http.server $(PORT) --bind 127.0.0.1 & \
	SERVER_PID=$$!; \
	trap "kill $$SERVER_PID 2>/dev/null; tailscale serve --https=$(PORT) off 2>/dev/null" EXIT INT TERM; \
	echo "Starting Tailscale HTTPS serve on port $(PORT) (proxying 127.0.0.1:$(PORT))..."; \
	tailscale serve --https=$(PORT) 127.0.0.1:$(PORT)
