Pod::Spec.new do |s|
  s.name = 'OsunaWordStream'
  s.version = '0.1.0'
  s.summary = 'Native word streaming for Osuna'
  s.description = 'Native word streaming for Osuna'
  s.license = { :type => 'MIT', :file => '../LICENSE' }
  s.author = 'chinhae <autuhae@gmail.com>'
  s.homepage = 'https://github.com/LFT-OXY/Osuna'
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = ['*.swift', 'internal/*.swift']
end
