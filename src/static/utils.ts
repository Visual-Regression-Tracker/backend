export function isHddStaticServiceConfigured() {
  return !process.env.STATIC_SERVICE || process.env.STATIC_SERVICE === 'hdd';
}
