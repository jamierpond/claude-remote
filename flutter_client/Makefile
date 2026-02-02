.PHONY: get build run ios ios-sim ios-release clean doctor gen watch

# Install dependencies
get:
	flutter pub get

# Generate code (freezed, riverpod, json_serializable)
gen:
	dart run build_runner build --delete-conflicting-outputs

# Watch for changes and regenerate
watch:
	dart run build_runner watch --delete-conflicting-outputs

# Run on connected device (auto-detect)
run:
	flutter run

# iOS development (physical device)
ios:
	flutter run -d pond

ios-sim:
	flutter run -d "iPhone"

ios-release:
	flutter run -d pond --release

# List available devices
devices:
	flutter devices

# Open iOS simulator
sim:
	open -a Simulator

# Build iOS
build-ios:
	flutter build ios --debug

build-ios-release:
	flutter build ios --release

# Install pods (if needed)
pods:
	cd ios && pod install

# Clean everything
clean:
	flutter clean
	cd ios && rm -rf Pods Podfile.lock
	rm -rf .dart_tool build

# Check setup
doctor:
	flutter doctor -v

# Full setup from scratch
setup: get gen pods

# Dev workflow: get deps, generate code, run on iOS sim
dev: get gen ios-sim
