# Adds a test-only target to the disposable CI project; no product settings/pins change.
require 'xcodeproj'
project_path, source_path = ARGV
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |target| target.name == 'App' }
abort 'App target missing' unless app
abort 'Smoke target already present' if project.targets.any? { |target| target.name == 'StageSmokeUITests' }
target = project.new_target(:ui_test_bundle, 'StageSmokeUITests', :ios, '15.0')
file = project.main_group.new_file(File.expand_path(source_path))
target.add_file_references([file])
target.add_dependency(app)
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'dev.tasknotes.app.stage-smoke-tests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'TEST_TARGET_NAME' => 'App',
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'CODE_SIGNING_ALLOWED' => 'NO',
    'CODE_SIGNING_REQUIRED' => 'NO'
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project_path, 'StageSmoke', true)
