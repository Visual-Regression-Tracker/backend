export const KNOWN_FALSE_PASSES: Record<string, string> = {
  'change-chrome-set2 · build-mixed-table [light] · table-row-dividers': 'faint border, as weak as the noise around it',
  'change-chrome-set5 · build-mixed-table [dark] · table-count-off-by-one':
    'one digit: DINOv2 scores it below anti-aliasing',
  'change-chrome-set5 · build-mixed-table [light] · table-count-off-by-one':
    'one digit: DINOv2 scores it below anti-aliasing',
  'change-chrome-set5 · details-checkpoint [dark] · checkpoint-label-typo':
    'two letters swapped: DINOv2 scores it below anti-aliasing',
  'change-chrome-set5 · details-checkpoint [light] · checkpoint-label-typo':
    'two letters swapped: DINOv2 scores it below anti-aliasing',
  'change-chrome-set5 · variation-details [dark] · vdetails-history-count':
    'one digit: DINOv2 scores it below anti-aliasing',
  'change-chrome-set5 · variation-details [light] · vdetails-history-count':
    'one digit: DINOv2 scores it below anti-aliasing',
  'change-chrome-set5 · variations [dark] · variations-reset-misaligned':
    '12px shift of one button under the blur threshold',
  'change-chromium-143-swiftshader-set4 · details-unresolved [dark] · details-diff-percent':
    'one digit: DINOv2 scores it below anti-aliasing',
  'change-chromium-143-swiftshader-set4 · details-unresolved [light] · details-diff-percent':
    'one digit: DINOv2 scores it below anti-aliasing',
  'change-chromium-143-swiftshader-set4 · login [dark] · login-link-colour':
    'text colour change under the blur threshold',
  'change-chromium-143-swiftshader-set4 · login [light] · login-link-colour':
    'text colour change under the blur threshold',
  'change-chromium-143-swiftshader-set4 · register [dark] · register-submit-typo':
    'two letters swapped: DINOv2 scores it below anti-aliasing',
  'change-chromium-143-swiftshader-set4 · users [dark] · users-role-typo':
    'one letter: DINOv2 scores it below anti-aliasing',
  'change-chromium-143-swiftshader-set4 · users [light] · users-role-typo':
    'one letter: DINOv2 scores it below anti-aliasing',
  'change-chromium-143-swiftshader-set4 · variations [dark] · variations-card-outline':
    'faint border, as weak as the noise around it',
  'change-chromium-143-swiftshader-set4 · variations [light] · variations-card-outline':
    'faint border, as weak as the noise around it',
  'change-swiftshader-set3 · build-filtered [dark] · filtered-chip-no-delete-icon':
    'small light icon under the blur threshold',
  'change-swiftshader-set3 · build-filtered [light] · filtered-chip-no-delete-icon':
    'small light icon under the blur threshold',
  'change-swiftshader-set3 · build-mixed-grid [dark] · grid-card-borders':
    'faint border, as weak as the noise around it',
  'change-swiftshader-set3 · build-mixed-grid [light] · grid-card-borders':
    'faint border, as weak as the noise around it',
};
