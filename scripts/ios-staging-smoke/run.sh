#!/usr/bin/env bash
# One workflow, three isolated/serial simulator sessions, two source builds.
set -euo pipefail
umask 077
root="$PWD"
work="$RUNNER_TEMP/tasknotes-stage-smoke"
mkdir -p "$work" "$root/smoke-results"
for key in SMOKE_STANDALONE_EMAIL SMOKE_STANDALONE_PASSWORD SMOKE_STANDALONE_COLLECTION_NAME SMOKE_SEEDED_EMAIL SMOKE_SEEDED_PASSWORD SMOKE_COLLECTION_NAME SMOKE_EXISTING_TASK SMOKE_TASK_TITLE; do
  [[ -n "${!key:-}" ]] || { echo "Missing approved CI input: $key; no authentication attempted"; exit 1; }
done
runtime=$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; r=[r for r in json.load(sys.stdin)["runtimes"] if r.get("isAvailable") and ".iOS-" in r["identifier"]]; print(sorted(r,key=lambda r:tuple(map(int,r["version"].split("."))))[-1]["identifier"])')
# xcodeproj ships with CocoaPods on macos-15; no signing setup is used.
ruby -rxcodeproj -e ''

build_tests() {
  local checkout="$1" output="$2"
  ruby "$root/scripts/ios-staging-smoke/configure-ui-tests.rb" "$checkout/ios/App/App.xcodeproj" "$root/ios/SmokeTests/StageSmoke.swift"
  xcodebuild -project "$checkout/ios/App/App.xcodeproj" -scheme StageSmoke -configuration Debug \
    -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$output" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build-for-testing
}

run_case() {
  local scenario="$1" output="$2"
  local device status=0
  device=$(xcrun simctl create "tasknotes-stage-$scenario" 'iPhone 16' "$runtime") || return 1
  xcrun simctl boot "$device" || return 1
  xcrun simctl bootstatus "$device" -b || return 1
  # Private simulator-test input only, never a repo file/artifact or shell argv.
  SMOKE_SCENARIO="$scenario" SMOKE_BUILD="$output" SMOKE_RUN_FILE="$work/$scenario.xctestrun" python3 - <<'PY' || return 1
import glob, os, plistlib
source=glob.glob(os.environ['SMOKE_BUILD']+'/Build/Products/*.xctestrun')
assert len(source)==1, 'Expected one UI-test run configuration'
with open(source[0],'rb') as f: data=plistlib.load(f)
scenario=os.environ['SMOKE_SCENARIO']
role='STANDALONE' if scenario=='standalone' else 'SEEDED'
env={key:os.environ[key] for key in ['SMOKE_COLLECTION_NAME','SMOKE_EXISTING_TASK','SMOKE_TASK_TITLE']}
env.update(SMOKE_SCENARIO=scenario,SMOKE_EMAIL=os.environ['SMOKE_'+role+'_EMAIL'],SMOKE_PASSWORD=os.environ['SMOKE_'+role+'_PASSWORD'])
if scenario=='standalone': env['SMOKE_COLLECTION_NAME']=os.environ['SMOKE_STANDALONE_COLLECTION_NAME']
count=0
def update(value):
 global count
 if isinstance(value,dict):
  if value.get('IsUITestBundle'):
   value.setdefault('EnvironmentVariables',{}).update(env); count+=1
  else:
   for child in value.values(): update(child)
 elif isinstance(value,list):
  for child in value: update(child)
update(data)
assert count==1, 'Expected exactly one UI-test target'
# Resolve __TESTROOT__ relative to the ORIGINAL build directory, not this private file.
def paths(value):
 if isinstance(value,dict):
  for key,child in value.items(): value[key]=paths(child)
 elif isinstance(value,list): value=[paths(child) for child in value]
 elif isinstance(value,str): value=value.replace('__TESTROOT__',os.path.dirname(source[0]))
 return value
with open(os.environ['SMOKE_RUN_FILE'],'wb') as f: plistlib.dump(paths(data),f)
PY
  # XCTest logs/results may contain typed text or login screenshots: NEVER upload.
  xcodebuild test-without-building -xctestrun "$work/$scenario.xctestrun" \
    -destination "platform=iOS Simulator,id=$device" -parallel-testing-enabled NO \
    -test-iterations 1 -resultBundlePath "$work/$scenario.xcresult" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO > "$work/$scenario.private.log" 2>&1 || status=$?
  SMOKE_STATUS="$status" SMOKE_SCENARIO="$scenario" SMOKE_LOG="$work/$scenario.private.log" python3 - <<'PY'
import json,os,re
allowed={'native_return','standalone_signed_in','known_task','created','edited','completed','reopened','foreground','web_roundtrip','legacy_update_refusal','legacy_generic_refusal'}
with open(os.environ['SMOKE_LOG'],errors='replace') as f:
 phases=[phase for phase in re.findall(r'TN_STAGE_PHASE:([a-z_]+)',f.read()) if phase in allowed]
result={'scenario':os.environ['SMOKE_SCENARIO'],'exitCode':int(os.environ['SMOKE_STATUS']),'phases':phases,'retainedPreWaveSession':'NOT_RUN' if os.environ['SMOKE_SCENARIO']=='legacy' else None}
with open('smoke-results/'+os.environ['SMOKE_SCENARIO']+'.json','w') as f: json.dump(result,f,indent=2)
print(json.dumps(result))
PY
  xcrun simctl shutdown "$device"
  xcrun simctl delete "$device"
  rm -f "$work/$scenario.xctestrun"
  return "$status"
}

build_tests "$root" "$work/next-build"
next_status=0
run_case standalone "$work/next-build" || next_status=1
# A failed control does not grant permission to improvise authentication/fixtures.
if [[ "$next_status" == 0 ]]; then run_case seeded "$work/next-build" || next_status=1; fi

# Released 1.0.8 source. Only compile-time Stage endpoint/manifest configuration differs.
legacy="$RUNNER_TEMP/tasknotes-ios108"
git worktree add --detach "$legacy" 618a54d42419404dac7ec60601af35fdeee7ba14
(
  cd "$legacy"
  corepack pnpm install --frozen-lockfile
  TASKNOTES_APP_URL=https://staging.tasknotes-app.pages.dev \
    VITE_MDBASE_CONNECT_URL=https://connect-staging.mdbase.dev \
    VITE_MDBASE_CONNECT_LOOPBACK_URL= \
    corepack pnpm build
  corepack pnpm exec cap sync ios
)
build_tests "$legacy" "$work/legacy-build"
legacy_status=0
run_case legacy "$work/legacy-build" || legacy_status=1
[[ "$next_status" == 0 && "$legacy_status" == 0 ]]
