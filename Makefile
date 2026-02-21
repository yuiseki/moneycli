NPM=npm
TSX=./node_modules/.bin/tsx

install-deps:
	$(NPM) install --no-audit --no-fund --prefer-offline

build: install-deps
	$(NPM) run build

test: build
	$(NPM) test

run:
	$(TSX) src/index.ts

sync:
	$(TSX) src/index.ts sync

clean:
	rm -rf dist

install-global:
	$(NPM) install -g .
